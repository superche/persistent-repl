export const VERSION = "0.2.0";
export const SEMANTICS_VERSION = "cell-scope/1.0.0";
export const SCHEMA_VERSION = "1.0.0";
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Schema = Record<string, unknown>;
export interface ResourcePolicy {
  maxSessions: number;
  idleMs: number;
  retentionMs: number;
  startupMs: number;
  wallMs: number;
  maxWallMs: number;
  rpcMs: number;
  approvalMs: number;
  cleanupMs: number;
  drainMs: number;
  codeBytes: number;
  frameBytes: number;
  outputBytes: number;
  imageBytes: number;
  images: number;
  imagePixels: number;
  rpcCount: number;
  pending: number;
  handles: number;
  heapBytes: number;
  rssBytes: number;
  consumerMs: number;
  maxRetainedCalls: number;
}
export const DEFAULT_POLICY: Readonly<ResourcePolicy> = Object.freeze({
  maxSessions: 8,
  idleMs: 300_000,
  retentionMs: 300_000,
  startupMs: 5_000,
  wallMs: 60_000,
  maxWallMs: 120_000,
  rpcMs: 30_000,
  approvalMs: 30_000,
  cleanupMs: 1_000,
  drainMs: 1_000,
  codeBytes: 65_536,
  frameBytes: 8_000_000,
  outputBytes: 131_072,
  imageBytes: 5_242_880,
  images: 4,
  imagePixels: 16_777_216,
  rpcCount: 256,
  pending: 64,
  handles: 256,
  heapBytes: 64 * 1024 ** 2,
  rssBytes: 256 * 1024 ** 2,
  consumerMs: 100,
  maxRetainedCalls: 1024,
});
export interface TrustedCallContext {
  ownerKey: string;
  taskKey: string;
  turnKey: string;
  callKey: string;
  authorizationRevision: string;
  signal?: AbortSignal;
}
export interface Correlation {
  sessionId: string;
  kernelEpoch: string;
  executionId: string;
  rpcId: string;
}
export interface DomainError {
  sourceExecutionId?: string;
  code: string;
  message: string;
  stage: string;
  recoverability?: string;
  receipt?: Json;
  line?: number;
  column?: number;
}
export interface ExternalReceipt extends Correlation {
  provider: string;
  method: string;
  stage: string;
  dispatched: "no" | "yes" | "unknown";
  outcome: "known" | "unknown";
  effect?: "confirmed" | "partial" | "unknown";
  error?: DomainError;
  observation?: Json;
  domain?: Json;
}
export type OutputPayload =
  | { type: "text"; text: string }
  | { type: "value"; value: Json }
  | {
      type: "image";
      mimeType: string;
      data: string;
      width: number;
      height: number;
      identity?: Json;
    };
export type OutputItem = OutputPayload & {
  itemId: string;
  executionId: string;
  seq: number;
  truncated?: boolean;
};
export type OutputEvent = OutputItem & {
  sessionId: string;
  kernelEpoch: string;
};
export interface ExecInput {
  code: string;
  timeoutMs?: number;
  title?: string;
}
export interface ExecRejected {
  accepted: false;
  code: string;
  message: string;
  stage: string;
  recovery: string[];
}
export interface ExecResult {
  accepted: true;
  executionId: string;
  kernelEpoch: string;
  status: "completed" | "failed" | "cancelled" | "timed_out" | "crashed";
  output: OutputItem[];
  bindings: "retained" | "cleared" | "unavailable";
  error?: DomainError;
  warnings: { code: string; message: string; line?: number }[];
  externalCalls: { pending: number; outcome: "none" | "known" | "unknown" };
  receipts: ExternalReceipt[];
  diagnostics: { truncated: boolean; durationMs: number; recovery: string[] };
}
export type Cleanup = "confirmed" | "pending" | "unknown";
export interface SessionRef {
  readonly sessionId: string;
}
export interface SessionStatus {
  sessionId: string;
  kernelEpoch: string;
  state: "new" | "ready" | "running" | "faulted" | "disposed" | "expired";
  executionId?: string;
  canContinue: boolean;
  capabilityRevision: string;
  authorizationRevision: string;
  blockedReason?: string;
  kernelPid?: number;
  lastResult?: ExecResult;
}
export interface CancelResult {
  stopped: boolean;
  kernelAlive: boolean;
  cleanup: Cleanup;
  executionId?: string;
  recovery: string[];
}
export interface ResetResult {
  reset: boolean;
  oldEpoch: string;
  kernelEpoch: string;
  invalidated: string[];
  cleanup: Cleanup;
  error?: string;
}
export interface DisposeResult extends CancelResult {
  disposed: true;
}
export interface ModuleRegistration {
  name: string;
  version: string;
  license: string;
  source: string;
  kind: "package" | "workspace";
  reload?: "next-cell";
}
export interface AuthorizationRequest extends Correlation {
  provider: string;
  method: string;
  args: Readonly<Json>;
  target?: string;
  context: Readonly<TrustedCallContext>;
  signal: AbortSignal;
}
export type AuthorizationHook = (
  request: AuthorizationRequest,
) => boolean | Promise<boolean>;
export interface HandlerContext extends Correlation {
  trusted: Readonly<TrustedCallContext>;
  signal: AbortSignal;
  deadline: number;
  resource<T>(definition: ResourceDefinition<T>): ResourceValue;
  receipt(
    details: Partial<
      Pick<
        ExternalReceipt,
        | "stage"
        | "dispatched"
        | "outcome"
        | "effect"
        | "error"
        | "observation"
        | "domain"
      >
    >,
  ): void;
}
export interface MethodDefinition {
  params: Schema;
  result: Schema;
  documentation: string;
  mutation?: boolean;
  handler(
    args: Json,
    context: HandlerContext,
    resource?: unknown,
  ): unknown | Promise<unknown>;
}
export interface ResourceDefinition<T = unknown> {
  kind: string;
  target: string;
  value: T;
  methods: Record<string, MethodDefinition>;
  expiresAt: number;
  cleanup(reason: string): Cleanup | Promise<Cleanup>;
}
/** Created only through HandlerContext.resource, recognized by host object identity. */
export interface ResourceValue {
  readonly resourceId: string;
}
export interface ServiceProvider {
  name: string;
  version: string;
  documentation: string;
  methods: Record<string, MethodDefinition>;
  dispose?(sessionId: string, reason: string): Cleanup | Promise<Cleanup>;
  /** Trusted kernel-side facade source, evaluated once at bootstrap. No host closures. */
  facade?: { global: string; source: string };
}
export interface TrustedSessionConfig {
  ownerKey: string;
  taskKey: string;
  workspaceScopeKey?: string;
  semanticsVersion: string;
  capabilityRevision: string;
  authorizationRevision: string;
  policy?: Partial<ResourcePolicy>;
  providers?: ServiceProvider[];
  modules?: ModuleRegistration[];
  authorize: AuthorizationHook;
  /** Required for product tasks that can survive a host restart. Synthetic ephemeral tasks may omit it. */
  recovery?: import("./recovery.js").RecoveryJournal;
  onOutput?: (event: OutputEvent) => void | Promise<void>;
  onDiagnostic?: (event: DiagnosticEvent) => void;
}
export interface DiagnosticEvent {
  sessionId: string;
  kernelEpoch: string;
  executionId?: string;
  stage: string;
  code: string;
  durationMs?: number;
}
