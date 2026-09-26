/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as lib_pipeline from "../lib/pipeline.js";
import type * as lib_realtimekit from "../lib/realtimekit.js";
import type * as lib_runtime from "../lib/runtime.js";
import type * as lib_webhooks from "../lib/webhooks.js";
import type * as lifecycle from "../lifecycle.js";
import type * as pipeline from "../pipeline.js";
import type * as rooms from "../rooms.js";
import type * as testing_fakeRealtimeKit from "../testing/fakeRealtimeKit.js";
import type * as testing_signedWebhooks from "../testing/signedWebhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  "lib/pipeline": typeof lib_pipeline;
  "lib/realtimekit": typeof lib_realtimekit;
  "lib/runtime": typeof lib_runtime;
  "lib/webhooks": typeof lib_webhooks;
  lifecycle: typeof lifecycle;
  pipeline: typeof pipeline;
  rooms: typeof rooms;
  "testing/fakeRealtimeKit": typeof testing_fakeRealtimeKit;
  "testing/signedWebhooks": typeof testing_signedWebhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
