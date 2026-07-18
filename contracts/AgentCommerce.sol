// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AgentCommerce
 * @notice Agent-to-agent marketplace for services, data, and compute.
 *         Agents can buy/sell capabilities, subscribe to data feeds,
 *         and settle micropayments trustlessly.
 */
contract AgentCommerce is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ───────────────────────────────────────────────

    enum ServiceType {
        DataFeed,        // Price oracles, market data, news
        Computation,     // Off-chain ML inference, processing
        Arbitrage,       // Arbitrage signal sharing
        Strategy,        // Trading strategy execution
        Monitoring,      // Portfolio monitoring & alerts
        Execution        // Order execution services
    }

    enum OrderStatus { Open, Filled, Cancelled, Disputed, Resolved }

    struct ServiceListing {
        bytes32 agentId;            // Provider agent
        ServiceType serviceType;
        string name;
        string description;
        address paymentToken;        // ERC20 or address(0) for ETH
        uint256 pricePerUnit;        // Price in payment token (with decimals)
        uint256 unitSize;            // e.g. seconds, queries, bytes
        uint256 minUnits;
        uint256 maxUnits;
        uint256 totalEarned;
        uint256 totalOrders;
        bool active;
        uint256 createdAt;
        bytes32 slaHash;             // IPFS hash of SLA document
    }

    struct ServiceOrder {
        bytes32 listingId;
        bytes32 buyerAgentId;
        bytes32 sellerAgentId;
        uint256 units;
        uint256 totalPrice;
        address paymentToken;
        OrderStatus status;
        uint256 createdAt;
        uint256 deliveredAt;
        bytes32 deliveryProofHash;   // Hash of delivered data/service proof
        uint256 escrowAmount;
        bool buyerConfirmed;
        bool sellerConfirmed;
    }

    struct Escrow {
        bytes32 orderId;
        address token;
        uint256 amount;
        uint256 releaseAfter;        // Timestamp after which seller can claim
        bool released;
        bool refunded;
    }

    struct Reputation {
        uint256 totalOrders;
        uint256 successfulOrders;
        uint256 disputedOrders;
        uint256 score;               // 0-1000
    }

    // ─── Storage ─────────────────────────────────────────────

    mapping(bytes32 => ServiceListing) public listings;
    mapping(bytes32 => ServiceOrder) public orders;
    mapping(bytes32 => Escrow) public escrows;
    mapping(bytes32 => Reputation) public reputations;   // agentId => reputation
    mapping(bytes32 => bytes32[]) public agentListings;  // agentId => listingIds
    mapping(bytes32 => bytes32[]) public agentOrders;    // agentId => orderIds

    uint256 public platformFeeBps = 50;     // 0.5% platform fee
    address public feeRecipient;
    uint256 public escrowWindow = 24 hours; // Time seller must wait after delivery
    uint256 public disputeWindow = 48 hours;

    bytes32[] public allListingIds;
    bytes32[] public allOrderIds;

    // ─── Events ──────────────────────────────────────────────

    event ListingCreated(bytes32 indexed listingId, bytes32 indexed agentId, ServiceType serviceType);
    event OrderCreated(bytes32 indexed orderId, bytes32 indexed listingId, bytes32 indexed buyerAgentId);
    event OrderDelivered(bytes32 indexed orderId, bytes32 deliveryProofHash);
    event OrderConfirmed(bytes32 indexed orderId);
    event OrderDisputed(bytes32 indexed orderId, string reason);
    event EscrowReleased(bytes32 indexed orderId, address recipient, uint256 amount);
    event ReputationUpdated(bytes32 indexed agentId, uint256 oldScore, uint256 newScore);

    constructor(address _feeRecipient) {
        feeRecipient = _feeRecipient;
    }

    // ─────────────────────────────────────────────────────────
    // LISTINGS
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Create a service listing. Anyone with a registered agent can list.
     */
    function createListing(
        bytes32 agentId,
        ServiceType serviceType,
        string calldata name,
        string calldata description,
        address paymentToken,
        uint256 pricePerUnit,
        uint256 unitSize,
        uint256 minUnits,
        uint256 maxUnits,
        bytes32 slaHash
    ) external returns (bytes32 listingId) {
        require(pricePerUnit > 0, "Price must be > 0");
        require(maxUnits >= minUnits, "Invalid unit range");

        listingId = keccak256(abi.encodePacked(
            agentId, serviceType, name, block.timestamp, allListingIds.length
        ));

        listings[listingId] = ServiceListing({
            agentId: agentId,
            serviceType: serviceType,
            name: name,
            description: description,
            paymentToken: paymentToken,
            pricePerUnit: pricePerUnit,
            unitSize: unitSize,
            minUnits: minUnits,
            maxUnits: maxUnits,
            totalEarned: 0,
            totalOrders: 0,
            active: true,
            createdAt: block.timestamp,
            slaHash: slaHash
        });

        agentListings[agentId].push(listingId);
        allListingIds.push(listingId);

        emit ListingCreated(listingId, agentId, serviceType);
    }

    // ─────────────────────────────────────────────────────────
    // ORDERS & ESCROW
    // ─────────────────────────────────────────────────────────

    /**
     * @notice Place an order. Funds go into escrow immediately.
     */
    function placeOrder(
        bytes32 listingId,
        bytes32 buyerAgentId,
        uint256 units
    ) external payable nonReentrant returns (bytes32 orderId) {
        ServiceListing storage listing = listings[listingId];
        require(listing.active, "Listing not active");
        require(units >= listing.minUnits && units <= listing.maxUnits, "Invalid units");

        uint256 totalPrice = listing.pricePerUnit * units;
        uint256 fee = (totalPrice * platformFeeBps) / 10_000;
        uint256 escrowAmount = totalPrice - fee;

        // Handle payment
        if (listing.paymentToken == address(0)) {
            require(msg.value >= totalPrice, "Insufficient ETH");
            // Return excess
            if (msg.value > totalPrice) {
                payable(msg.sender).transfer(msg.value - totalPrice);
            }
            // Send fee
            payable(feeRecipient).transfer(fee);
        } else {
            IERC20(listing.paymentToken).safeTransferFrom(msg.sender, address(this), totalPrice);
            IERC20(listing.paymentToken).safeTransfer(feeRecipient, fee);
        }

        orderId = keccak256(abi.encodePacked(
            listingId, buyerAgentId, units, block.timestamp, allOrderIds.length
        ));

        orders[orderId] = ServiceOrder({
            listingId: listingId,
            buyerAgentId: buyerAgentId,
            sellerAgentId: listing.agentId,
            units: units,
            totalPrice: totalPrice,
            paymentToken: listing.paymentToken,
            status: OrderStatus.Open,
            createdAt: block.timestamp,
            deliveredAt: 0,
            deliveryProofHash: bytes32(0),
            escrowAmount: escrowAmount,
            buyerConfirmed: false,
            sellerConfirmed: false
        });

        escrows[orderId] = Escrow({
            orderId: orderId,
            token: listing.paymentToken,
            amount: escrowAmount,
            releaseAfter: 0,        // Set on delivery
            released: false,
            refunded: false
        });

        listing.totalOrders++;
        agentOrders[buyerAgentId].push(orderId);
        agentOrders[listing.agentId].push(orderId);
        allOrderIds.push(orderId);

        emit OrderCreated(orderId, listingId, buyerAgentId);
    }

    /**
     * @notice Seller submits delivery proof (content hash of delivered data)
     */
    function submitDelivery(
        bytes32 orderId,
        bytes32 deliveryProofHash
    ) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(order.status == OrderStatus.Open, "Order not open");

        order.deliveredAt = block.timestamp;
        order.deliveryProofHash = deliveryProofHash;
        order.status = OrderStatus.Filled;

        escrows[orderId].releaseAfter = block.timestamp + escrowWindow;

        emit OrderDelivered(orderId, deliveryProofHash);
    }

    /**
     * @notice Buyer confirms delivery, releasing escrow to seller
     */
    function confirmDelivery(bytes32 orderId) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        require(order.status == OrderStatus.Filled, "Not delivered");

        order.buyerConfirmed = true;
        _releaseEscrow(orderId, _getSellerAddress(order.sellerAgentId));

        // Update reputations
        _updateReputation(order.buyerAgentId, true);
        _updateReputation(order.sellerAgentId, true);

        emit OrderConfirmed(orderId);
    }

    /**
     * @notice Seller claims escrow after window (if buyer hasn't disputed)
     */
    function claimEscrow(bytes32 orderId) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        Escrow storage escrow = escrows[orderId];

        require(order.status == OrderStatus.Filled, "Not delivered");
        require(!escrow.released && !escrow.refunded, "Already settled");
        require(block.timestamp >= escrow.releaseAfter, "Escrow window active");

        _releaseEscrow(orderId, _getSellerAddress(order.sellerAgentId));
        _updateReputation(order.sellerAgentId, true);
    }

    /**
     * @notice Buyer raises a dispute within the window
     */
    function raiseDispute(bytes32 orderId, string calldata reason) external nonReentrant {
        ServiceOrder storage order = orders[orderId];
        Escrow storage escrow = escrows[orderId];

        require(order.status == OrderStatus.Filled, "Not delivered");
        require(!escrow.released, "Already released");
        require(block.timestamp < escrow.releaseAfter, "Dispute window closed");

        order.status = OrderStatus.Disputed;
        _updateReputation(order.sellerAgentId, false);

        emit OrderDisputed(orderId, reason);
    }

    // ─────────────────────────────────────────────────────────
    // INTERNAL
    // ─────────────────────────────────────────────────────────

    function _releaseEscrow(bytes32 orderId, address recipient) internal {
        Escrow storage escrow = escrows[orderId];
        require(!escrow.released && !escrow.refunded, "Already settled");

        escrow.released = true;
        uint256 amount = escrow.amount;

        if (escrow.token == address(0)) {
            payable(recipient).transfer(amount);
        } else {
            IERC20(escrow.token).safeTransfer(recipient, amount);
        }

        emit EscrowReleased(orderId, recipient, amount);
    }

    function _updateReputation(bytes32 agentId, bool positive) internal {
        Reputation storage rep = reputations[agentId];
        uint256 oldScore = rep.score;

        rep.totalOrders++;
        if (positive) {
            rep.successfulOrders++;
            rep.score = _min(1000, rep.score + 2);
        } else {
            rep.disputedOrders++;
            rep.score = rep.score >= 20 ? rep.score - 20 : 0;
        }

        emit ReputationUpdated(agentId, oldScore, rep.score);
    }

    // Stub - in production, cross-reference with AgentRegistry
    function _getSellerAddress(bytes32 /*agentId*/) internal view returns (address) {
        return feeRecipient; // Simplified: replace with registry lookup
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    // ─── View ─────────────────────────────────────────────────

    function getListing(bytes32 listingId) external view returns (ServiceListing memory) {
        return listings[listingId];
    }

    function getOrder(bytes32 orderId) external view returns (ServiceOrder memory) {
        return orders[orderId];
    }

    function getReputation(bytes32 agentId) external view returns (Reputation memory) {
        return reputations[agentId];
    }

    function getAgentListings(bytes32 agentId) external view returns (bytes32[] memory) {
        return agentListings[agentId];
    }
}
