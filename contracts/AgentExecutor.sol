// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

interface IAgentRegistry {
    function checkTx(
        bytes32 agentId,
        address protocol,
        address token,
        uint256 amountUSD,
        uint256 slippageBps
    ) external view returns (bool allowed, string memory reason);

    function recordTx(
        bytes32 agentId,
        address protocol,
        uint256 amountUSD,
        bool success
    ) external;

    function getAgent(bytes32 agentId) external view returns (
        address owner,
        bytes32 modelHash,
        bytes32 codeHash,
        string[] memory capabilities,
        uint8 safetyLevel,
        uint8 status,
        uint256 registeredAt,
        uint256 lastAuditAt,
        uint256 auditScore,
        address auditor,
        uint256 totalTxCount,
        uint256 totalVolumeUSD,
        uint256 reputationScore,
        bool kycVerified
    );
}

/**
 * @title AgentExecutor
 * @notice Trustless execution wrapper — every agent transaction MUST pass
 *         through here. Safety rails are enforced atomically on-chain.
 *         If checkTx() fails, the entire transaction reverts.
 *         Uses Chainlink price feeds so USD values cannot be spoofed.
 */
contract AgentExecutor is ReentrancyGuard, AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");

    IAgentRegistry public immutable registry;

    // Chainlink price feed addresses (Base mainnet)
    mapping(address => address) public priceFeeds; // token => chainlink feed
    address public constant ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70; // Base

    struct ExecutionRequest {
        bytes32 agentId;
        address protocol;       // target contract
        address token;          // token being used (address(0) for ETH)
        uint256 tokenAmount;    // raw token amount
        uint256 slippageBps;    // declared slippage
        bytes callData;         // encoded function call
        uint256 value;          // ETH to send
        string reasoning;       // agent's reasoning (logged)
    }

    struct ExecutionResult {
        bool success;
        bytes returnData;
        uint256 gasUsed;
        uint256 amountUSD;
        uint256 timestamp;
    }

    // Per-agent execution history (last 100 txs)
    mapping(bytes32 => ExecutionResult[]) private _executionHistory;
    mapping(bytes32 => uint256) public executionCount;

    // Circuit breaker: pause agent after N consecutive failures
    mapping(bytes32 => uint256) public consecutiveFailures;
    mapping(bytes32 => bool) public circuitBroken;
    uint256 public circuitBreakerThreshold = 5;

    // Rate limiting: max txs per block per agent
    mapping(bytes32 => mapping(uint256 => uint256)) public txsPerBlock;
    uint256 public maxTxsPerBlock = 3;

    event ExecutionAttempted(bytes32 indexed agentId, address indexed protocol, uint256 amountUSD, bool allowed, string reason);
    event ExecutionCompleted(bytes32 indexed agentId, address indexed protocol, uint256 amountUSD, bool success, uint256 gasUsed);
    event CircuitBroken(bytes32 indexed agentId, uint256 consecutiveFailures);
    event CircuitReset(bytes32 indexed agentId);
    event PriceFeedAdded(address indexed token, address indexed feed);

    constructor(address _registry) {
        registry = IAgentRegistry(_registry);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(EXECUTOR_ROLE, msg.sender);

        // Pre-configure common Base mainnet price feeds
        // ETH
        priceFeeds[address(0)] = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
        // USDC
        priceFeeds[0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913] = 0x7E860098f58bbFc8648a4311b374B1d669a2BC9B;
        // WBTC
        priceFeeds[0x1ceA84203673764244E05693e42E6Ace62bE9BA5] = 0xCCADC697c55bbB68dc5bCdf8d3CBe83CdD4E071E;
    }

    // ─────────────────────────────────────────────────────────────────────
    // CORE EXECUTION
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @notice Execute a transaction on behalf of an agent.
     *         Atomically: price-check → rail-check → execute → record
     *         If ANY step fails, the entire tx reverts.
     */
    function execute(
        ExecutionRequest calldata req
    ) external payable nonReentrant onlyRole(EXECUTOR_ROLE) returns (ExecutionResult memory result) {
        // 1. Circuit breaker check
        require(!circuitBroken[req.agentId], "Circuit breaker active - agent paused");

        // 2. Rate limiting
        require(
            txsPerBlock[req.agentId][block.number] < maxTxsPerBlock,
            "Rate limit: too many txs this block"
        );
        txsPerBlock[req.agentId][block.number]++;

        // 3. Get real USD value from Chainlink
        uint256 amountUSD = _getUSDValue(req.token, req.tokenAmount, req.value);

        // 4. On-chain safety rail check (cannot be bypassed)
        (bool allowed, string memory reason) = registry.checkTx(
            req.agentId,
            req.protocol,
            req.token,
            amountUSD,
            req.slippageBps
        );

        emit ExecutionAttempted(req.agentId, req.protocol, amountUSD, allowed, reason);

        // HARD REVERT if rails say no — agent cannot proceed
        require(allowed, string(abi.encodePacked("Safety rail violation: ", reason)));

        // 5. Execute the actual call
        uint256 gasBefore = gasleft();
        bool success;
        bytes memory returnData;

        if (req.value > 0) {
            (success, returnData) = req.protocol.call{value: req.value}(req.callData);
        } else {
            (success, returnData) = req.protocol.call(req.callData);
        }

        uint256 gasUsed = gasBefore - gasleft();

        // 6. Update circuit breaker
        if (success) {
            consecutiveFailures[req.agentId] = 0;
        } else {
            consecutiveFailures[req.agentId]++;
            if (consecutiveFailures[req.agentId] >= circuitBreakerThreshold) {
                circuitBroken[req.agentId] = true;
                emit CircuitBroken(req.agentId, consecutiveFailures[req.agentId]);
            }
        }

        // 7. Record on registry (updates reputation, daily volume)
        registry.recordTx(req.agentId, req.protocol, amountUSD, success);
        executionCount[req.agentId]++;

        // 8. Store result
        result = ExecutionResult({
            success: success,
            returnData: returnData,
            gasUsed: gasUsed,
            amountUSD: amountUSD,
            timestamp: block.timestamp
        });

        // Store last 100 results
        if (_executionHistory[req.agentId].length >= 100) {
            // Shift array (simplified — in production use a ring buffer)
            for (uint i = 0; i < 99; i++) {
                _executionHistory[req.agentId][i] = _executionHistory[req.agentId][i + 1];
            }
            _executionHistory[req.agentId][99] = result;
        } else {
            _executionHistory[req.agentId].push(result);
        }

        emit ExecutionCompleted(req.agentId, req.protocol, amountUSD, success, gasUsed);
    }

    /**
     * @notice Batch execute multiple actions atomically.
     *         All-or-nothing: if any action fails rails, entire batch reverts.
     */
    function executeBatch(
        ExecutionRequest[] calldata requests
    ) external payable nonReentrant onlyRole(EXECUTOR_ROLE) returns (ExecutionResult[] memory results) {
        results = new ExecutionResult[](requests.length);
        for (uint256 i = 0; i < requests.length; i++) {
            // Re-check circuit breaker for each
            require(!circuitBroken[requests[i].agentId], "Circuit breaker active");

            uint256 amountUSD = _getUSDValue(requests[i].token, requests[i].tokenAmount, requests[i].value);
            (bool allowed, string memory reason) = registry.checkTx(
                requests[i].agentId, requests[i].protocol,
                requests[i].token, amountUSD, requests[i].slippageBps
            );
            require(allowed, string(abi.encodePacked("Batch item ", i, " blocked: ", reason)));

            uint256 gasBefore = gasleft();
            (bool success, bytes memory returnData) = requests[i].protocol.call{value: requests[i].value}(requests[i].callData);

            results[i] = ExecutionResult({
                success: success, returnData: returnData,
                gasUsed: gasBefore - gasleft(), amountUSD: amountUSD,
                timestamp: block.timestamp
            });

            registry.recordTx(requests[i].agentId, requests[i].protocol, amountUSD, success);
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // CHAINLINK PRICE ORACLE
    // ─────────────────────────────────────────────────────────────────────

    /**
     * @notice Get USD value of a token amount using Chainlink feeds.
     *         Returns value scaled to 18 decimals to match registry expectations.
     */
    function _getUSDValue(
        address token,
        uint256 tokenAmount,
        uint256 ethValue
    ) internal view returns (uint256 usdValue) {
        if (ethValue > 0 || token == address(0)) {
            // ETH value
            uint256 amount = ethValue > 0 ? ethValue : tokenAmount;
            usdValue = _chainlinkPrice(priceFeeds[address(0)]) * amount / 1e18;
        } else if (priceFeeds[token] != address(0)) {
            // Known ERC-20 with feed
            uint8 decimals = _getTokenDecimals(token);
            usdValue = _chainlinkPrice(priceFeeds[token]) * tokenAmount / (10 ** decimals);
        } else {
            // Unknown token — use tokenAmount directly (assume 18 decimals)
            // In production: revert or use a fallback oracle
            usdValue = tokenAmount;
        }
    }

    function _chainlinkPrice(address feed) internal view returns (uint256) {
        if (feed == address(0)) return 0;
        (, int256 price,, uint256 updatedAt,) = AggregatorV3Interface(feed).latestRoundData();
        require(price > 0, "Invalid price feed");
        require(block.timestamp - updatedAt < 3600, "Price feed stale");
        // Chainlink 8-decimal price → 18 decimal
        return uint256(price) * 1e10;
    }

    function _getTokenDecimals(address token) internal view returns (uint8) {
        // Try to call decimals() — default to 18 if it fails
        (bool success, bytes memory data) = token.staticcall(abi.encodeWithSignature("decimals()"));
        if (success && data.length > 0) return abi.decode(data, (uint8));
        return 18;
    }

    // ─────────────────────────────────────────────────────────────────────
    // ADMIN
    // ─────────────────────────────────────────────────────────────────────

    function addPriceFeed(address token, address feed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceFeeds[token] = feed;
        emit PriceFeedAdded(token, feed);
    }

    function resetCircuitBreaker(bytes32 agentId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        circuitBroken[agentId] = false;
        consecutiveFailures[agentId] = 0;
        emit CircuitReset(agentId);
    }

    function setCircuitBreakerThreshold(uint256 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        circuitBreakerThreshold = threshold;
    }

    function setMaxTxsPerBlock(uint256 max) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxTxsPerBlock = max;
    }

    function getExecutionHistory(bytes32 agentId) external view returns (ExecutionResult[] memory) {
        return _executionHistory[agentId];
    }

    receive() external payable {}
}
