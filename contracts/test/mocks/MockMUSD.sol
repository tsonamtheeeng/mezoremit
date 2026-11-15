// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @dev Plain 18-decimal ERC-20 with EIP-2612 permit, standing in for MUSD.
contract MockMUSD is ERC20, ERC20Permit {
    constructor() ERC20("Mezo USD", "MUSD") ERC20Permit("Mezo USD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev ERC-20 without permit (permit calls revert / hit no function).
contract MockNoPermit is ERC20 {
    constructor() ERC20("NoPermit", "NP") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
