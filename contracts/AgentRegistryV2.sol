// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title AgentRegistryV2
 * @notice Upgradeable version of AgentRegistry.
 *         Uses UUPS proxy pattern — only the DAO timelock can authorize upgrades.
 *         All state is preserved across upgrades.
 *
 * @dev Upgrade path: deploy new implementation → DAO proposal → timelock → upgradeToAndCall()
 */
contract AgentRegistryV2 is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using ECDSA for bytes32;

    // ─── Roles ───────────────────────────────────────────────────────────
    bytes32 public constant AUDITOR_ROLE   = keccak256("AUDITOR_ROLE");
    bytes32 public constant OPERATOR_ROLE  = keccak256("OPERATOR_ROLE");
    bytes32 public constant UPGRADER_ROLE  = keccak256("UPGRADER_ROLE"); // DAO timelock only

    // ─── EIP-712 ─────────────────────────────────────────────────────────
    bytes32 public constant AGENT_REGISTRATION_TYPEHASH = keccak256(
        "AgentRegistration(address owner,bytes32 modelHash,string[] capabilities,uint8 safetyLevel,uint256 nonce,uint256 deadline)"
    );

    // ─── Enums ───────────────────────────────────────────────────────────
    enum AgentStatus   { Pending, Active, Suspended, Deprecated }
    enum SafetyLevel   { Minimal, Standard, Strict, Paranoid }

    // ─── Structs ─────────────────────────────────────────────────────────
    struct Agent {
        address owner;
        bytes32 modelHash;
        bytes32 codeHash;
        string[] capabilities;
        SafetyLevel safetyLevel;
        AgentStatus status;
        uint256 registeredAt;
        uint256 lastAuditAt;
        uint256 auditScore;
        address auditor;
        uint256 totalTxCount;
        uint256 totalVolumeUSD;
        uint256 reputationScore;
        bool kycVerified;
        // V2 additions
        address executor;           // designated AgentExecutor address
        uint256 lastActivityAt;     // last tx timestamp
        string metadataURI;         // IPFS URI for off-chain metadata
    }

    struct SafetyRails {
        uint256 maxSingleTxUSD;
        uint256 maxDailyVolumeUSD;
        uint256 maxSlippageBps;
        address[] allowedProtocols;
        address[] allowedTokens;
        bool requiresMultisig;
        uint256 multisigThresholdUSD;
        uint256 cooldownPeriod;
    }

    struct AuditRecord {
        address auditor;
        uint256 timestamp;
        uint8 score;
        bytes32 reportHash;
        string[] findings;
        bool passed;
    }

    // ─── Storage ─────────────────────────────────────────────────────────
    mapping(bytes32 => Agent)                          public agents;
    mapping(bytes32 => SafetyRails)                    public safetyRails;
    mapping(bytes32 => AuditRecord[])                  public auditHistory;
    mapping(address => bytes32[])                      public ownerAgents;
    mapping(bytes32 => mapping(uint256 => uint256))    public dailyVolume;
    mapping(bytes32 => uint256)                        public lastLargeTx;
    mapping(address => uint256)                        public nonces;

    bytes32[] public allAgentIds;
    uint256   public registrationFee;
    uint256   public totalAgents;

    // V2: fee discount for FORGE token holders
    address public forgeToken;
    uint256 public discountThreshold;   // min FORGE to get discount
    uint256 public discountedFeeBps;    // e.g. 5000 = 50% off

    // V2: insurance fund
    address public insuranceFund;
    uint256 public insuranceFeeBps;     // % of registration fee → insurance

    // ─── Events ──────────────────────────────────────────────────────────
    event AgentRegistered(bytes32 indexed agentId, address indexed owner, bytes32 modelHash);
    event AgentStatusChanged(bytes32 indexed agentId, AgentStatus oldStatus, AgentStatus newStatus);
    event AgentAudited(bytes32 indexed agentId, address indexed auditor, uint8 score, bool passed);
    event SafetyRailsUpdated(bytes32 indexed agentId, address indexed updatedBy);
    event TxExecuted(bytes32 indexed agentId, address indexed protocol, uint256 amountUSD);
    event TxBlocked(bytes32 indexed agentId, string reason);
    event ReputationUpdated(bytes32 indexed agentId, uint256 oldScore, uint256 newScore);
    event MetadataUpdated(bytes32 indexed agentId, string metadataURI);
    event ExecutorSet(bytes32 indexed agentId, address executor);

    // ─────────────────────────────────────────────────────────────────────
    // INITIALIZER (replaces constructor for upgradeable)
    // ─────────────────────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address admin,
        address _forgeToken,
        address _insuranceFund
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __EIP712_init("AgentForge", "2");
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(AUDITOR_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin); // Transfer to DAO timelock after setup

        registrationFee  = 0.01 ether;
        forgeToken       = _forgeToken;
        insuranceFund    = _insuranceFund;
        discountThreshold = 10_000e18;  // 10k FORGE for discount
        discountedFeeBps  = 5000;       // 50% off
        insuranceFeeBps   = 1000;       // 10% of fee → insurance
    }

    // ─────────────────────────────────────────────────────────────────────
    // REGISTRATION
    // ─────────────────────────────────────────────────────────────────────

    function registerAgent(
        bytes32 modelHash,
        bytes32 codeHash,
        string[] calldata capabilities,
        SafetyLevel safetyLevel,
        SafetyRails calldata rails,
        string calldata metadataURI,
        uint256 deadline,
        bytes calldata signature
    ) external payable nonReentrant returns (bytes32 agentId) {
        uint256 fee = _calculateFee(msg.sender);
        require(msg.value >= fee, "Insufficient registration fee");
        require(block.timestamp <= deadline, "Signature expired");

        // Verify EIP-712 sig
        bytes32 structHash = keccak256(abi.encode(
            AGENT_REGISTRATION_TYPEHASH,
            msg.sender, modelHash,
            keccak256(abi.encode(capabilities)),
            uint8(safetyLevel), nonces[msg.sender]++, deadline
        ));
        address signer = _hashTypedDataV4(structHash).recover(signature);
        require(signer == msg.sender, "Invalid signature");

        _validateRailsForSafetyLevel(rails, safetyLevel);

        agentId = keccak256(abi.encodePacked(
            msg.sender, modelHash, codeHash, block.timestamp, totalAgents
        ));
        require(agents[agentId].registeredAt == 0, "Agent exists");

        agents[agentId] = Agent({
            owner: msg.sender, modelHash: modelHash, codeHash: codeHash,
            capabilities: capabilities, safetyLevel: safetyLevel,
            status: AgentStatus.Pending, registeredAt: block.timestamp,
            lastAuditAt: 0, auditScore: 0, auditor: address(0),
            totalTxCount: 0, totalVolumeUSD: 0, reputationScore: 500,
            kycVerified: false, executor: address(0),
            lastActivityAt: block.timestamp, metadataURI: metadataURI
        });

        safetyRails[agentId] = rails;
        ownerAgents[msg.sender].push(agentId);
        allAgentIds.push(agentId);
        totalAgents++;

        // Route insurance portion
        uint256 insuranceAmount = (fee * insuranceFeeBps) / 10_000;
        if (insuranceAmount > 0 && insuranceFund != address(0)) {
            payable(insuranceFund).transfer(insuranceAmount);
        }

        // Return excess
        if (msg.value > fee) payable(msg.sender).transfer(msg.value - fee);

        emit AgentRegistered(agentId, msg.sender, modelHash);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SAFETY RAIL ENFORCEMENT
    // ─────────────────────────────────────────────────────────────────────

    function checkTx(
        bytes32 agentId,
        address protocol,
        address token,
        uint256 amountUSD,
        uint256 slippageBps
    ) external view returns (bool allowed, string memory reason) {
        Agent storage agent = agents[agentId];
        SafetyRails storage rails = safetyRails[agentId];

        if (agent.status != AgentStatus.Active)         return (false, "Agent not active");
        if (amountUSD > rails.maxSingleTxUSD)           return (false, "Exceeds single tx limit");
        if (slippageBps > rails.maxSlippageBps)         return (false, "Slippage too high");

        uint256 today = block.timestamp / 1 days;
        if (dailyVolume[agentId][today] + amountUSD > rails.maxDailyVolumeUSD)
            return (false, "Exceeds daily volume limit");

        if (amountUSD >= rails.multisigThresholdUSD) {
            if (block.timestamp - lastLargeTx[agentId] < rails.cooldownPeriod)
                return (false, "Cooldown period active");
        }

        if (rails.allowedProtocols.length > 0) {
            bool ok;
            for (uint i = 0; i < rails.allowedProtocols.length; i++)
                if (rails.allowedProtocols[i] == protocol) { ok = true; break; }
            if (!ok) return (false, "Protocol not whitelisted");
        }

        if (rails.allowedTokens.length > 0 && token != address(0)) {
            bool ok;
            for (uint i = 0; i < rails.allowedTokens.length; i++)
                if (rails.allowedTokens[i] == token) { ok = true; break; }
            if (!ok) return (false, "Token not whitelisted");
        }

        return (true, "");
    }

    function recordTx(
        bytes32 agentId, address protocol,
        uint256 amountUSD, bool success
    ) external onlyRole(OPERATOR_ROLE) {
        Agent storage agent = agents[agentId];
        require(agent.status == AgentStatus.Active, "Agent not active");

        uint256 today = block.timestamp / 1 days;
        dailyVolume[agentId][today] += amountUSD;
        agent.totalTxCount++;
        agent.totalVolumeUSD += amountUSD;
        agent.lastActivityAt = block.timestamp;

        if (amountUSD >= safetyRails[agentId].multisigThresholdUSD)
            lastLargeTx[agentId] = block.timestamp;

        uint256 old = agent.reputationScore;
        agent.reputationScore = success
            ? _min(1000, agent.reputationScore + 1)
            : (agent.reputationScore > 10 ? agent.reputationScore - 10 : 0);

        emit TxExecuted(agentId, protocol, amountUSD);
        if (agent.reputationScore != old)
            emit ReputationUpdated(agentId, old, agent.reputationScore);
    }

    // ─────────────────────────────────────────────────────────────────────
    // AUDITING
    // ─────────────────────────────────────────────────────────────────────

    function submitAudit(
        bytes32 agentId, uint8 score, bytes32 reportHash,
        string[] calldata findings, bool passed
    ) external onlyRole(AUDITOR_ROLE) {
        require(agents[agentId].registeredAt > 0, "Agent not found");
        require(score <= 100, "Score out of range");

        auditHistory[agentId].push(AuditRecord({
            auditor: msg.sender, timestamp: block.timestamp,
            score: score, reportHash: reportHash, findings: findings, passed: passed
        }));

        agents[agentId].lastAuditAt = block.timestamp;
        agents[agentId].auditScore  = score;
        agents[agentId].auditor     = msg.sender;

        if (passed && score >= 70 && agents[agentId].status == AgentStatus.Pending)
            _setStatus(agentId, AgentStatus.Active);
        if (score < 40 && agents[agentId].status == AgentStatus.Active)
            _setStatus(agentId, AgentStatus.Suspended);

        emit AgentAudited(agentId, msg.sender, score, passed);
    }

    function emergencySuspend(bytes32 agentId, string calldata reason) external {
        require(hasRole(AUDITOR_ROLE, msg.sender) || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not authorized");
        _setStatus(agentId, AgentStatus.Suspended);
        emit TxBlocked(agentId, reason);
    }

    // ─────────────────────────────────────────────────────────────────────
    // V2: METADATA & EXECUTOR
    // ─────────────────────────────────────────────────────────────────────

    function updateMetadata(bytes32 agentId, string calldata metadataURI) external {
        require(agents[agentId].owner == msg.sender, "Not owner");
        agents[agentId].metadataURI = metadataURI;
        emit MetadataUpdated(agentId, metadataURI);
    }

    function setExecutor(bytes32 agentId, address executor) external {
        require(agents[agentId].owner == msg.sender, "Not owner");
        agents[agentId].executor = executor;
        emit ExecutorSet(agentId, executor);
    }

    // ─────────────────────────────────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────────────────────────────────

    function _calculateFee(address user) internal view returns (uint256) {
        if (forgeToken != address(0) && discountThreshold > 0) {
            try IERC20(forgeToken).balanceOf(user) returns (uint256 bal) {
                if (bal >= discountThreshold) {
                    return registrationFee * (10_000 - discountedFeeBps) / 10_000;
                }
            } catch {}
        }
        return registrationFee;
    }

    function _setStatus(bytes32 agentId, AgentStatus newStatus) internal {
        AgentStatus old = agents[agentId].status;
        agents[agentId].status = newStatus;
        emit AgentStatusChanged(agentId, old, newStatus);
    }

    function _validateRailsForSafetyLevel(SafetyRails calldata rails, SafetyLevel level) internal pure {
        if (level == SafetyLevel.Strict) {
            require(rails.maxSingleTxUSD <= 10_000e18, "Strict: tx limit too high");
            require(rails.maxSlippageBps <= 100, "Strict: slippage too high");
        }
        if (level == SafetyLevel.Paranoid) {
            require(rails.maxSingleTxUSD <= 1_000e18, "Paranoid: tx limit too high");
            require(rails.maxSlippageBps <= 30, "Paranoid: slippage too high");
            require(rails.requiresMultisig, "Paranoid: must require multisig");
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) { return a < b ? a : b; }

    // ─────────────────────────────────────────────────────────────────────
    // UUPS — only DAO timelock can authorize upgrade
    // ─────────────────────────────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation)
        internal override onlyRole(UPGRADER_ROLE) {}

    // ─────────────────────────────────────────────────────────────────────
    // ADMIN (governed by DAO via timelock)
    // ─────────────────────────────────────────────────────────────────────

    function setRegistrationFee(uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        registrationFee = fee;
    }

    function setInsuranceFund(address fund) external onlyRole(DEFAULT_ADMIN_ROLE) {
        insuranceFund = fund;
    }

    function setDiscount(uint256 threshold, uint256 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        discountThreshold = threshold;
        discountedFeeBps = bps;
    }

    function withdraw() external onlyRole(DEFAULT_ADMIN_ROLE) {
        payable(msg.sender).transfer(address(this).balance);
    }

    // View helpers
    function getAgent(bytes32 agentId) external view returns (Agent memory) { return agents[agentId]; }
    function getAuditHistory(bytes32 agentId) external view returns (AuditRecord[] memory) { return auditHistory[agentId]; }
    function getOwnerAgents(address owner) external view returns (bytes32[] memory) { return ownerAgents[owner]; }
    function getAllAgentIds() external view returns (bytes32[] memory) { return allAgentIds; }
    function calculateFee(address user) external view returns (uint256) { return _calculateFee(user); }
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
}
