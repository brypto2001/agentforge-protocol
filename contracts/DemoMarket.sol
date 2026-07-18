// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DemoMarket
 * @notice On-chain "venue" for AgentForge autonomous agents on testnet.
 *         Real DeFi on Sepolia is sparse — this market accepts rail-gated
 *         execute() calls so the full trust loop is proven end-to-end:
 *         register → audit → AgentExecutor.execute → DemoMarket.trade → events.
 *
 *         amountUSD is the notional the agent claims (18 decimals). Rails on
 *         AgentRegistry enforce max single / daily limits via the Executor.
 */
contract DemoMarket {
    struct Trade {
        bytes32 agentId;
        address operator;
        uint256 amountUSD;
        string strategy;
        uint256 timestamp;
        bool success;
    }

    Trade[] public trades;
    mapping(bytes32 => uint256) public volumeByAgent;
    mapping(bytes32 => uint256) public tradesByAgent;
    mapping(string => uint256) public volumeByStrategy;

    event TradeExecuted(
        bytes32 indexed agentId,
        address indexed operator,
        uint256 amountUSD,
        string strategy,
        bool success
    );

    /**
     * @notice Execute a simulated strategy trade. Called via AgentExecutor.
     * @param agentId   AgentForge agent id
     * @param amountUSD Notional in 18-decimal USD units
     * @param strategy  Strategy tag e.g. "yield" | "arb" | "custom"
     */
    function trade(
        bytes32 agentId,
        uint256 amountUSD,
        string calldata strategy
    ) external returns (bool) {
        require(amountUSD > 0, "amount=0");
        require(bytes(strategy).length > 0, "no strategy");

        trades.push(
            Trade({
                agentId: agentId,
                operator: msg.sender,
                amountUSD: amountUSD,
                strategy: strategy,
                timestamp: block.timestamp,
                success: true
            })
        );

        volumeByAgent[agentId] += amountUSD;
        tradesByAgent[agentId] += 1;
        volumeByStrategy[strategy] += amountUSD;

        emit TradeExecuted(agentId, msg.sender, amountUSD, strategy, true);
        return true;
    }

    function tradeCount() external view returns (uint256) {
        return trades.length;
    }

    function getTrade(uint256 i) external view returns (Trade memory) {
        return trades[i];
    }
}
