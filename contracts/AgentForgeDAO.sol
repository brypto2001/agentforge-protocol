// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorSettings.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotesQuorumFraction.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorTimelockControl.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// FORGE TOKEN — ERC20Votes governance token
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title ForgeToken ($FORGE)
 * @notice Governance token for AgentForge DAO.
 *         Used for: voting on proposals, staking for auditor credentials,
 *         paying reduced registration fees, earning commerce revenue share.
 */
contract ForgeToken is ERC20, ERC20Permit, ERC20Votes {
    uint256 public constant MAX_SUPPLY = 100_000_000e18; // 100M FORGE

    // Allocation (minted at deploy)
    // 40% — Community/DAO treasury (vested over 4 years)
    // 25% — Protocol incentives (agent operators, auditors)
    // 20% — Team (2-year cliff, 4-year vest)
    // 10% — Early backers
    // 5%  — Public launch

    constructor(address treasury, address team, address incentives)
        ERC20("Forge Token", "FORGE")
        ERC20Permit("Forge Token")
    {
        _mint(treasury,   40_000_000e18);
        _mint(team,       20_000_000e18);
        _mint(incentives, 25_000_000e18);
        _mint(msg.sender, 15_000_000e18); // backers + launch
    }

    // Required overrides for ERC20Votes
    function _afterTokenTransfer(address from, address to, uint256 amount)
        internal override(ERC20, ERC20Votes) { super._afterTokenTransfer(from, to, amount); }

    function _mint(address to, uint256 amount)
        internal override(ERC20, ERC20Votes) { super._mint(to, amount); }

    function _burn(address account, uint256 amount)
        internal override(ERC20, ERC20Votes) { super._burn(account, amount); }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENTFORGE GOVERNOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title AgentForgeGovernor
 * @notice DAO Governor for the AgentForge Protocol.
 *
 *  What can be governed:
 *  - Grant/revoke AUDITOR_ROLE and OPERATOR_ROLE on registry
 *  - Change registration fees
 *  - Update safety level thresholds
 *  - Change slashing percentage on vault
 *  - Update platform fees on commerce
 *  - Add/remove price feeds on executor
 *  - Upgrade proxied contracts
 *
 *  Parameters:
 *  - Voting delay: 1 day (time between proposal and voting start)
 *  - Voting period: 5 days
 *  - Proposal threshold: 100,000 FORGE (0.1% of supply)
 *  - Quorum: 4% of total supply
 *  - Timelock: 2 days (delay between vote passing and execution)
 */
contract AgentForgeGovernor is
    Governor,
    GovernorSettings,
    GovernorCountingSimple,
    GovernorVotes,
    GovernorVotesQuorumFraction,
    GovernorTimelockControl
{
    constructor(
        IVotes _token,
        TimelockController _timelock
    )
        Governor("AgentForge Governor")
        GovernorSettings(
            1 days,      // voting delay
            5 days,      // voting period
            100_000e18   // proposal threshold: 100k FORGE
        )
        GovernorVotes(_token)
        GovernorVotesQuorumFraction(4) // 4% quorum
        GovernorTimelockControl(_timelock)
    {}

    // Required overrides
    function votingDelay() public view override(IGovernor, GovernorSettings) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(IGovernor, GovernorSettings) returns (uint256) {
        return super.votingPeriod();
    }

    function quorum(uint256 blockNumber)
        public view override(IGovernor, GovernorVotesQuorumFraction) returns (uint256) {
        return super.quorum(blockNumber);
    }

    function state(uint256 proposalId)
        public view override(Governor, GovernorTimelockControl) returns (ProposalState) {
        return super.state(proposalId);
    }

    function propose(
        address[] memory targets, uint256[] memory values,
        bytes[] memory calldatas, string memory description
    ) public override(Governor, IGovernor) returns (uint256) {
        return super.propose(targets, values, calldatas, description);
    }

    function proposalThreshold()
        public view override(Governor, GovernorSettings) returns (uint256) {
        return super.proposalThreshold();
    }

    function _execute(
        uint256 proposalId, address[] memory targets,
        uint256[] memory values, bytes[] memory calldatas, bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets, uint256[] memory values,
        bytes[] memory calldatas, bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor() internal view override(Governor, GovernorTimelockControl) returns (address) {
        return super._executor();
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(Governor, GovernorTimelockControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEPLOY HELPER — sets up timelock + governor in one transaction
// ─────────────────────────────────────────────────────────────────────────────

contract DAODeployer {
    event DAODeployed(
        address forgeToken,
        address timelock,
        address governor
    );

    function deploy(
        address treasury,
        address team,
        address incentives
    ) external returns (
        ForgeToken token,
        TimelockController timelock,
        AgentForgeGovernor governor
    ) {
        // Deploy token
        token = new ForgeToken(treasury, team, incentives);

        // Deploy timelock (2 day delay)
        address[] memory proposers = new address[](0); // governor set after
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone can execute passed proposals
        timelock = new TimelockController(2 days, proposers, executors, address(this));

        // Deploy governor
        governor = new AgentForgeGovernor(token, timelock);

        // Grant proposer role to governor
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));

        // Renounce admin role from deployer (fully decentralized)
        timelock.renounceRole(timelock.TIMELOCK_ADMIN_ROLE(), address(this));

        emit DAODeployed(address(token), address(timelock), address(governor));
    }
}
