// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITokenHooks} from "./HookToken.sol";

/// @dev Re-enters `target` with `payload` from a token hook. If `swallow` is true the reentry's revert data
///      is recorded and the outer call continues; otherwise the revert bubbles up.
contract ReentrantAttacker is ITokenHooks {
    address public target;
    bytes public payload;
    bool public swallow;
    bool public armed;
    bool public onSend; // fire in tokensToSend (else tokensReceived)
    bytes public lastRevert;
    uint256 public reentries;

    function arm(address target_, bytes calldata payload_, bool onSend_, bool swallow_) external {
        target = target_;
        payload = payload_;
        onSend = onSend_;
        swallow = swallow_;
        armed = true;
    }

    function exec(address to, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = to.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }

    function approve(IERC20 token, address spender, uint256 amount) external {
        token.approve(spender, amount);
    }

    function tokensToSend(address, address, uint256) external {
        if (onSend) _fire();
    }

    function tokensReceived(address, address, uint256) external {
        if (!onSend) _fire();
    }

    function _fire() private {
        if (!armed) return;
        armed = false;
        reentries++;
        (bool ok, bytes memory ret) = target.call(payload);
        if (!ok) {
            if (!swallow) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
            lastRevert = ret;
        }
    }
}
