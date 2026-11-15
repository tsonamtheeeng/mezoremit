// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITokenHooks {
    function tokensToSend(address from, address to, uint256 amount) external;
    function tokensReceived(address from, address to, uint256 amount) external;
}

/// @dev ERC-777-style token: calls `tokensToSend` on a contract sender before, and `tokensReceived` on a
///      contract recipient after, every transfer. Used to attempt reentrancy into RemittanceManager.
contract HookToken is ERC20 {
    mapping(address => bool) public hooked;

    constructor() ERC20("Hook", "HOOK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHooked(address who, bool on) external {
        hooked[who] = on;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && hooked[from]) ITokenHooks(from).tokensToSend(from, to, value);
        super._update(from, to, value);
        if (to != address(0) && hooked[to]) ITokenHooks(to).tokensReceived(from, to, value);
    }
}
