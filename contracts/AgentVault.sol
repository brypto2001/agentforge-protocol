// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AgentVault
 * @notice Staking vault for agent accountability. Agents stake tokens
 *         as collateral; malicious behavior triggers slashing.
 *         Also handles yield generation for idle agent capital.
 */
contract AgentVault is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    struct Stake {
        bytes32 agentId;
        address token;
        uint256 amount;
        uint256 stakedAt;
        uint256 unlockAt;
        uint256 slashedAmount;
        bool active;
    }

    struct SlashEvent {
        bytes32 agentId;
        uint256 amount;
        string reason;
        address initiator;
        uint256 timestamp;
    }

    // Minimum stakes by safety level (in USDC equivalent, 6 decimals)
    uint256 public constant MIN_STAKE_MINIMAL  = 100e6;    // $100
    uint256 public constant MIN_STAKE_STANDARD = 1_000e6;  // $1,000
    uint256 public constant MIN_STAKE_STRICT   = 10_000e6; // $10,000
    uint256 public constant MIN_STAKE_PARANOID = 50_000e6; // $50,000

    uint256 public lockPeriod = 7 days;
    uint256 public slashBps = 1000;          // 10% slash for violations
    address public slashBeneficiary;          // Where slashed funds go (DAO treasury)

    mapping(bytes32 => Stake[]) public agentStakes;     // agentId => stakes
    mapping(bytes32 => uint256) public totalStaked;     // agentId => total active stake
    SlashEvent[] public slashHistory;

    event Staked(bytes32 indexed agentId, address token, uint256 amount);
    event Unstaked(bytes32 indexed agentId, address token, uint256 amount);
    event Slashed(bytes32 indexed agentId, uint256 amount, string reason);
    event StakeWithdrawn(bytes32 indexed agentId, uint256 stakeIndex);

    constructor(address _slashBeneficiary) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SLASHER_ROLE, msg.sender);
        slashBeneficiary = _slashBeneficiary;
    }

    /**
     * @notice Stake tokens for an agent
     */
    function stake(
        bytes32 agentId,
        address token,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        agentStakes[agentId].push(Stake({
            agentId: agentId,
            token: token,
            amount: amount,
            stakedAt: block.timestamp,
            unlockAt: block.timestamp + lockPeriod,
            slashedAmount: 0,
            active: true
        }));

        totalStaked[agentId] += amount;
        emit Staked(agentId, token, amount);
    }

    /**
     * @notice Stake ETH for an agent
     */
    function stakeETH(bytes32 agentId) external payable nonReentrant {
        require(msg.value > 0, "No ETH sent");

        agentStakes[agentId].push(Stake({
            agentId: agentId,
            token: address(0),
            amount: msg.value,
            stakedAt: block.timestamp,
            unlockAt: block.timestamp + lockPeriod,
            slashedAmount: 0,
            active: true
        }));

        totalStaked[agentId] += msg.value;
        emit Staked(agentId, address(0), msg.value);
    }

    /**
     * @notice Withdraw a stake after lock period
     */
    function withdrawStake(
        bytes32 agentId,
        uint256 stakeIndex
    ) external nonReentrant {
        Stake storage s = agentStakes[agentId][stakeIndex];
        require(s.active, "Stake not active");
        require(block.timestamp >= s.unlockAt, "Still locked");

        s.active = false;
        uint256 withdrawAmount = s.amount - s.slashedAmount;
        totalStaked[agentId] -= s.amount;

        if (s.token == address(0)) {
            payable(msg.sender).transfer(withdrawAmount);
        } else {
            IERC20(s.token).safeTransfer(msg.sender, withdrawAmount);
        }

        emit StakeWithdrawn(agentId, stakeIndex);
    }

    /**
     * @notice Slash an agent's stake for bad behavior
     */
    function slash(
        bytes32 agentId,
        string calldata reason
    ) external onlyRole(SLASHER_ROLE) nonReentrant {
        Stake[] storage stakes = agentStakes[agentId];
        uint256 totalSlashed = 0;

        for (uint256 i = 0; i < stakes.length; i++) {
            if (!stakes[i].active) continue;
            uint256 slashAmount = (stakes[i].amount * slashBps) / 10_000;
            stakes[i].slashedAmount += slashAmount;
            totalSlashed += slashAmount;

            // Transfer slashed amount to beneficiary
            if (stakes[i].token == address(0)) {
                payable(slashBeneficiary).transfer(slashAmount);
            } else {
                IERC20(stakes[i].token).safeTransfer(slashBeneficiary, slashAmount);
            }
        }

        slashHistory.push(SlashEvent({
            agentId: agentId,
            amount: totalSlashed,
            reason: reason,
            initiator: msg.sender,
            timestamp: block.timestamp
        }));

        emit Slashed(agentId, totalSlashed, reason);
    }

    function getAgentStakes(bytes32 agentId) external view returns (Stake[] memory) {
        return agentStakes[agentId];
    }

    function hasMinimumStake(bytes32 agentId, uint8 safetyLevel) external view returns (bool) {
        uint256 minRequired;
        if (safetyLevel == 0) minRequired = MIN_STAKE_MINIMAL;
        else if (safetyLevel == 1) minRequired = MIN_STAKE_STANDARD;
        else if (safetyLevel == 2) minRequired = MIN_STAKE_STRICT;
        else minRequired = MIN_STAKE_PARANOID;
        return totalStaked[agentId] >= minRequired;
    }
}
