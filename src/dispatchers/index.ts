/**
 * Public surface for the five dispatch classes.
 */

export {
  type Dispatcher,
  type LoadedPlugin,
  orderForChain,
  STOP_CHAIN,
  type StopChain,
} from "./types.js";
export { SingletonDispatcher } from "./singleton.js";
export { BroadcastCollectDispatcher } from "./broadcast_collect.js";
export {
  BroadcastNotifyDispatcher,
  type BroadcastNotifyResult,
} from "./broadcast_notify.js";
export { ChainDispatcher } from "./chain.js";
export { CapabilityDispatcher, type CapabilityRequirement } from "./capability.js";
