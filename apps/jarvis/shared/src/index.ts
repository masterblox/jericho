export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type IsoTimestamp = string;

export enum SourceType {
  User = 'user',
  Connector = 'connector',
  Agent = 'agent',
  System = 'system',
  Sensor = 'sensor',
  Import = 'import',
}

export enum LifecycleStatus {
  Draft = 'draft',
  Queued = 'queued',
  PendingApproval = 'pending_approval',
  Approved = 'approved',
  Active = 'active',
  Paused = 'paused',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Rejected = 'rejected',
  Archived = 'archived',
}

export enum RiskLevel {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

export enum RouteType {
  Local = 'local',
  Agent = 'agent',
  Connector = 'connector',
  HumanApproval = 'human_approval',
  Blocked = 'blocked',
}

/** The single semantic route chosen for an understood intent. */
export enum IntentRoute {
  Reply = 'reply',
  Action = 'action',
  Project = 'project',
  Knowledge = 'knowledge',
  Signal = 'signal',
  Review = 'review',
}

export enum AgentLane {
  Dev = 'dev',
  Angela = 'angela',
  Donald = 'donald',
  Iris = 'iris',
  Researcher = 'researcher',
  Analyst = 'analyst',
}

export enum MutationClass {
  ReadOnly = 'read_only',
  Reversible = 'reversible',
  Destructive = 'destructive',
  Production = 'production',
}

export enum EscalationReason {
  CostBudget = 'cost_budget',
  RuntimeBudget = 'runtime_budget',
  ConcurrencyBudget = 'concurrency_budget',
  RetryBudget = 'retry_budget',
  NewRecipient = 'new_recipient',
  NewSystem = 'new_system',
  RepositoryExpansion = 'repository_expansion',
  CredentialExpansion = 'credential_expansion',
  DataExpansion = 'data_expansion',
  ToolExpansion = 'tool_expansion',
  ChannelExpansion = 'channel_expansion',
  ObjectiveChange = 'objective_change',
  AcceptanceTestChange = 'acceptance_test_change',
  DestructiveMutation = 'destructive_mutation',
  ProductionMutation = 'production_mutation',
  ContradictoryEvidence = 'contradictory_evidence',
  UncertainExternalAction = 'uncertain_external_action',
}

export enum CostClass {
  Local = 'local',
  Low = 'low',
  Standard = 'standard',
  Premium = 'premium',
}

export enum CostCategory {
  Model = 'model',
  Tool = 'tool',
  Connector = 'connector',
  Other = 'other',
}

export enum FreshnessStatus {
  Fresh = 'fresh',
  Stale = 'stale',
  Unknown = 'unknown',
}

export enum EntityType {
  Person = 'person',
  Organization = 'organization',
  Project = 'project',
  Task = 'task',
  Location = 'location',
  Topic = 'topic',
  Document = 'document',
  Account = 'account',
  Device = 'device',
  Agent = 'agent',
  Service = 'service',
  Conversation = 'conversation',
  Commitment = 'commitment',
  Repository = 'repository',
  Run = 'run',
  Note = 'note',
  Artifact = 'artifact',
  Other = 'other',
}

export enum RelationType {
  SameAs = 'same_as',
  MemberOf = 'member_of',
  Owns = 'owns',
  WorksFor = 'works_for',
  DependsOn = 'depends_on',
  AssignedTo = 'assigned_to',
  Mentions = 'mentions',
  RelatedTo = 'related_to',
  LocatedAt = 'located_at',
  ParentOf = 'parent_of',
  Supports = 'supports',
  ConflictsWith = 'conflicts_with',
  SpouseOf = 'spouse_of',
}

export enum IntentKind {
  Observe = 'observe',
  Query = 'query',
  Command = 'command',
  Goal = 'goal',
  Preference = 'preference',
  Correction = 'correction',
  Cancellation = 'cancellation',
}

export enum MissionTaskKind {
  Analyze = 'analyze',
  Research = 'research',
  Communicate = 'communicate',
  Execute = 'execute',
  Monitor = 'monitor',
  Decide = 'decide',
  Custom = 'custom',
}

export enum ProposalKind {
  Plan = 'plan',
  Action = 'action',
  Message = 'message',
  DataChange = 'data_change',
  PreferenceChange = 'preference_change',
}

export enum ReceiptStatus {
  Pending = 'pending',
  Started = 'started',
  Succeeded = 'succeeded',
  Failed = 'failed',
  Denied = 'denied',
  RolledBack = 'rolled_back',
}

export enum DecisionOutcome {
  Approved = 'approved',
  Rejected = 'rejected',
  Deferred = 'deferred',
  Superseded = 'superseded',
}

export enum ReviewIntentDisposition {
  Dismiss = 'dismiss',
  ReclassifyProject = 'reclassify_project',
}

export enum ConnectorHealthStatus {
  Unknown = 'unknown',
  Healthy = 'healthy',
  Degraded = 'degraded',
  Unavailable = 'unavailable',
  Unauthorized = 'unauthorized',
  Disabled = 'disabled',
}

export enum ConnectorCapability {
  Capture = 'capture',
  Send = 'send',
  Search = 'search',
  Health = 'health',
}

export enum ExternalIdentityLinkStatus {
  Provisional = 'provisional',
  Established = 'established',
  Review = 'review',
}

export enum IdentityReviewKind {
  ProposedMerge = 'proposed_merge',
  Contradiction = 'contradiction',
  Collision = 'collision',
}

export enum IdentityReviewDisposition {
  EstablishObserved = 'establish_observed',
  RelinkCandidate = 'relink_candidate',
}

export enum CaptureFailureKind {
  InvalidPayload = 'invalid_payload',
  IdentityConflict = 'identity_conflict',
  Transport = 'transport',
  Authorization = 'authorization',
  CursorConflict = 'cursor_conflict',
  ContradictoryHistory = 'contradictory_history',
  Processing = 'processing',
}

export enum ChangeLogKind {
  EventCaptured = 'event_captured',
  IdentityObserved = 'identity_observed',
  RelationObserved = 'relation_observed',
  IdentityReview = 'identity_review',
  IdentityResolved = 'identity_resolved',
  CaptureFailed = 'capture_failed',
  CursorAdvanced = 'cursor_advanced',
  ProposalCreated = 'proposal_created',
  ProposalChanged = 'proposal_changed',
  MissionChanged = 'mission_changed',
  AssignmentChanged = 'assignment_changed',
  DecisionRecorded = 'decision_recorded',
  ReceiptChanged = 'receipt_changed',
  CostRecorded = 'cost_recorded',
  HealthChanged = 'health_changed',
  CorrectionApplied = 'correction_applied',
}

export enum CommandCenterActionKind {
  ApproveMission = 'approve_mission',
  RejectMission = 'reject_mission',
}

export enum CommandCenterMissionStage {
  Plan = 'plan',
  Approve = 'approve',
  Execute = 'execute',
  Present = 'present',
  Review = 'review',
}

export enum CommandCenterTimelineKind {
  Capture = 'capture',
  Understand = 'understand',
  Route = 'route',
  Plan = 'plan',
  Approve = 'approve',
  Execute = 'execute',
  Retain = 'retain',
  Present = 'present',
  /** @deprecated Retained for snapshots produced before lifecycle replay. */
  Mission = 'mission',
  /** @deprecated Retained for non-plan decisions and legacy snapshots. */
  Decision = 'decision',
  /** @deprecated Retained for legacy assignment snapshots. */
  Assignment = 'assignment',
  Outcome = 'outcome',
  Receipt = 'receipt',
}

export enum CommandCenterVerification {
  Integrity = 'integrity_verified',
  Outcome = 'outcome_verified',
  Destination = 'destination_verified',
  NotVerified = 'not_verified',
}

export enum NucleusNodeKind {
  Entity = 'entity',
  Evidence = 'evidence',
  Intent = 'intent',
  Mission = 'mission',
  Agent = 'agent',
  Assignment = 'assignment',
  Receipt = 'receipt',
}

export enum PreferenceScope {
  User = 'user',
  Workspace = 'workspace',
  Connector = 'connector',
  Global = 'global',
}

/** Deterministic Isabella guided-test phases owned by the Sphere/Core controller. */
export type GuidedTestPhase =
  | 'ready'
  | 'retrieving'
  | 'presenting'
  | 'opening'
  | 'correcting_organizing'
  | 'reviewing'
  | 'complete';

export const GUIDED_TEST_PHASES: readonly GuidedTestPhase[] = [
  'ready',
  'retrieving',
  'presenting',
  'opening',
  'correcting_organizing',
  'reviewing',
  'complete',
] as const;

/** User-local presentation voice preset. Stores only the preset name + timestamp. */
export interface VoicePresetPreference {
  voice: string;
  confirmedAt: IsoTimestamp;
}

export interface VoicePreviewRequest {
  voice: string;
  previewId: string;
}

export interface VoicePreviewState {
  previewId: string;
  voice: string;
  status: 'playing' | 'cancelled' | 'complete' | 'unavailable';
}

export interface IdentityEvidenceProvenance {
  relativePath: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface IdentityEvidenceGroup {
  fullName: string;
  canonical: boolean;
  ambiguous: boolean;
  relationshipToCarlos?: string;
  employment?: string[];
  provenance: IdentityEvidenceProvenance[];
}

/** Identity-aware vault retrieval result for guided narration. */
export interface IdentityAwareRetrievalResult {
  query: string;
  groups: IdentityEvidenceGroup[];
  excluded: IdentityEvidenceGroup[];
  resolved?: IdentityEvidenceGroup;
  retrievalCount: number;
}

/** Bounded route classification for runtime result grounding. */
export type KnowledgeRoute =
  | 'private_knowledge'
  | 'core_operational'
  | 'general'
  | 'clarification';

/** Confidence tier for a grounded identity or knowledge result. */
export type AnswerConfidence = 'strong' | 'partial' | 'ambiguous' | 'none';

/** Lifecycle phase for a grounded-result WebSocket message. */
export type GroundedResultPhase = 'retrieving' | 'resolved' | 'ambiguous' | 'unavailable';

/** Bounded provenance entry carried in every grounded result. */
export interface GroundedResultProvenance {
  relativePath: string;
  title: string;
  excerpt: string;
  score: number;
}

/** Actions a frontend may render for a resolved grounded result. */
export interface GroundedResultAction {
  open_note?: string;
  reorganize_notes?: boolean;
  correct_identity?: boolean;
}

/**
 * Unified WebSocket contract emitted as `grounded_result` for both natural
 * private questions and guided Isabella retrieval.
 *
 * The frontend MUST NOT require raw `tool_result` messages to construct
 * product UI from knowledge-card results.
 */
export interface GroundedResultEvent {
  resultId: string;
  phase: GroundedResultPhase;
  route: KnowledgeRoute;
  subject: string;
  confidence: AnswerConfidence;
  canonicalIdentity?: string;
  fullName?: string;
  relationship?: string;
  employment?: string[];
  provenance: GroundedResultProvenance[];
  actions: GroundedResultAction;
  retrievalCount: number;
  guided?: {
    test: 'isabella';
  };
}

export interface Freshness {
  observedAt: IsoTimestamp;
  validAt?: IsoTimestamp;
  staleAt?: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  status?: FreshnessStatus;
}

export interface Provenance {
  source: string;
  sourceType: SourceType;
  sourceEventId?: string;
  observedAt: IsoTimestamp;
  receivedAt?: IsoTimestamp;
  actorId?: string;
  confidence?: number;
  integrityHash?: string;
}

export interface EventEnvelope {
  id: string;
  source: string;
  sourceType: SourceType;
  sourceEventId: string;
  type: string;
  occurredAt: IsoTimestamp;
  ingestedAt: IsoTimestamp;
  payload: JsonValue;
  status?: LifecycleStatus;
  route?: RouteType;
  risk?: RiskLevel;
  confidence?: number;
  freshness?: Freshness;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface VersionedCursor {
  connectorId: string;
  capability: ConnectorCapability;
  partition: string;
  epoch: number;
  sequence: number;
  pageToken?: string;
  watermark?: IsoTimestamp;
  overlapFrom?: IsoTimestamp;
  version: number;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface ExternalIdentityObservation {
  connectorId: string;
  namespace: string;
  externalId: string;
  entityType: EntityType;
  displayName?: string;
  attributes: JsonObject;
  observedAt: IsoTimestamp;
  confidence: number;
  evidenceEventId: string;
  claimedEntityId?: string;
}

export interface ExternalIdentityKey {
  connectorId: string;
  namespace: string;
  externalId: string;
}

export interface ExternalRelationObservation {
  from: ExternalIdentityKey;
  to: ExternalIdentityKey;
  type: RelationType;
  attributes: JsonObject;
  observedAt: IsoTimestamp;
  evidenceEventId: string;
}

export interface ExternalIdentityLink {
  id: string;
  connectorId: string;
  namespace: string;
  externalId: string;
  entityId: string;
  status: ExternalIdentityLinkStatus;
  firstObservedAt: IsoTimestamp;
  lastObservedAt: IsoTimestamp;
  evidenceEventIds: string[];
  confidence: number;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface ExternalIdentityReviewCandidate {
  id: string;
  kind: IdentityReviewKind;
  connectorId: string;
  namespace: string;
  externalId: string;
  observedEntityId: string;
  candidateEntityIds: string[];
  reason: string;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  evidenceEventIds: string[];
  createdAt: IsoTimestamp;
  provenance: Provenance[];
}

export interface ExternalIdentityReviewEntity {
  id: string;
  type?: EntityType;
  label: string;
  available: boolean;
  compatible: boolean;
}

/** Authenticated, privacy-minimized review surface derived from an immutable capture failure. */
export interface ExternalIdentityReview {
  id: string;
  failureId: string;
  linkId: string;
  version: number;
  reviewHash: string;
  kind: IdentityReviewKind;
  connectorId: string;
  namespace: string;
  observedEntity: ExternalIdentityReviewEntity;
  candidateEntities: ExternalIdentityReviewEntity[];
  reason: string;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  evidenceEventIds: string[];
  evidence: EvidenceReference[];
  createdAt: IsoTimestamp;
  provenance: Provenance[];
  decision?: DecisionRecord;
}

export interface CaptureFailure {
  id: string;
  connectorId: string;
  capability: ConnectorCapability;
  kind: CaptureFailureKind;
  message: string;
  retryable: boolean;
  sourceEventId?: string;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  details: JsonObject;
  reviewCandidate?: ExternalIdentityReviewCandidate;
  occurredAt: IsoTimestamp;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface IdentityExclusion {
  id: string;
  entityId: string;
  claimPattern: string;
  excludedAt: IsoTimestamp;
  provenance: Provenance[];
  integrityHash: string;
}

export interface CorrectionPreview {
  id: string;
  version: number;
  previewHash: string;
  disputedClaim: string;
  sourceProvenance: Provenance[];
  currentIdentityBinding: {
    entityId: string;
    entityName: string;
    entityType: EntityType;
  };
  proposedExclusion: IdentityExclusion;
  coreEffects: {
    relationsToCreate: Array<{ fromEntityId: string; toEntityId: string; type: RelationType }>;
    relationsToRemove: string[];
    exclusionsToApply: IdentityExclusion[];
  };
  obsidianEffects: {
    notePath: string;
    noteHash: string;
    fieldsToAdd: Record<string, string>;
    fieldsToRemove: string[];
  };
  canonicalNotePath: string;
}

export interface CorrectionDecision {
  id: string;
  previewId: string;
  previewHash: string;
  previewVersion: number;
  canonicalNoteHash: string;
  canonicalNotePath: string;
  decidedBy: string;
  outcome: DecisionOutcome;
  decidedAt: IsoTimestamp;
  rationale: string;
  provenance: Provenance[];
}

export interface CoreReceipt {
  id: string;
  correctionId: string;
  status: 'succeeded' | 'failed' | 'partial';
  relationsCreated: string[];
  relationsRemoved: string[];
  exclusionsApplied: string[];
  completedAt: IsoTimestamp;
  integrityHash: string;
}

export interface ObsidianReceipt {
  status: 'succeeded' | 'failed' | 'skipped';
  notePath: string;
  fieldsWritten: string[];
  completedAt?: IsoTimestamp;
  error?: string;
}

export interface CorrectionPartialCompletion {
  coreReceipt: CoreReceipt;
  obsidianReceipt: ObsidianReceipt;
  allowsRetry: boolean;
  retryOnlyNote: boolean;
}

export interface CorrectionPreviewRequest {
  entityId: string;
  claimPattern: string;
  sourceProvenance: Provenance[];
  proposedRelationType: RelationType;
  proposedFromEntityId: string;
  proposedToEntityId: string;
  canonicalNotePath: string;
  canonicalNoteHash: string;
  obsidianFieldsToAdd: Record<string, string>;
  obsidianFieldsToRemove: string[];
}

export interface CorrectionPreviewResponse {
  preview: CorrectionPreview;
}

export interface CorrectionConfirmRequest {
  previewId: string;
  previewHash: string;
  previewVersion: number;
  entityId: string;
  claimPattern: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: RelationType;
  canonicalNoteHash: string;
  canonicalNotePath: string;
  obsidianFieldsToAdd: Record<string, string>;
}

export enum CorrectionConfirmStatus {
  Confirmed = 'confirmed',
  Rejected = 'rejected',
  Partial = 'partial',
  Idempotent = 'idempotent',
}

export interface CorrectionConfirmResponse {
  status: CorrectionConfirmStatus;
  correctionId: string;
  coreReceipt: CoreReceipt;
  obsidianReceipt?: ObsidianReceipt;
  partialCompletion?: CorrectionPartialCompletion;
}

export interface CorrectionRetryRequest {
  correctionId: string;
  canonicalNoteHash: string;
  canonicalNotePath: string;
}

export interface NormalizedCapture {
  event: EventEnvelope;
  identities: ExternalIdentityObservation[];
  relations: ExternalRelationObservation[];
}

export interface ChangeLog {
  id: string;
  sequence: number;
  kind: ChangeLogKind;
  connectorId?: string;
  recordType: string;
  recordId: string;
  eventId?: string;
  changedAt: IsoTimestamp;
  payload: JsonObject;
  integrityHash?: string;
}

export interface ConnectorLease {
  id: string;
  connectorId: string;
  capability: ConnectorCapability;
  ownerId: string;
  leaseToken: string;
  expiresAt: IsoTimestamp;
  version: number;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface Entity {
  id: string;
  type: EntityType;
  canonicalName: string;
  aliases: string[];
  attributes: JsonObject;
  status?: LifecycleStatus;
  risk?: RiskLevel;
  confidence?: number;
  freshness: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface Relation {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  type: RelationType;
  attributes: JsonObject;
  status?: LifecycleStatus;
  risk?: RiskLevel;
  confidence?: number;
  freshness: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface EvidenceReference {
  eventId: string;
  integrityHash?: string;
  selector?: string;
}

export interface EvidenceBackedStatement {
  text: string;
  evidence: EvidenceReference[];
  confidence: number;
}

export interface IntentDeadline {
  description: string;
  at: IsoTimestamp;
  confidence: number;
}

/** Read-only classifier output. It intentionally has no lifecycle state. */
export interface ClassificationDraft {
  kind: IntentKind;
  summary: string;
  suggestedRoute: IntentRoute;
  entityIds: string[];
  expectedOutcome?: string;
  commitments: EvidenceBackedStatement[];
  claims: EvidenceBackedStatement[];
  assumptions: EvidenceBackedStatement[];
  deadlines: IntentDeadline[];
  affectedPartyIds: string[];
  requiredEvidence: EvidenceReference[];
  requiredCapabilities: string[];
  ambiguityReasons: string[];
  contradictoryEvidenceEventIds: string[];
  risk: RiskLevel;
  confidence: number;
}

export interface IntentEnvelope {
  id: string;
  eventId?: string;
  source: string;
  sourceType: SourceType;
  actorEntityId?: string;
  kind: IntentKind;
  summary: string;
  payload: JsonObject;
  status: LifecycleStatus;
  route: IntentRoute;
  routeRuleId: string;
  entityIds: string[];
  expectedOutcome?: string;
  commitments: EvidenceBackedStatement[];
  claims: EvidenceBackedStatement[];
  assumptions: EvidenceBackedStatement[];
  deadlines: IntentDeadline[];
  affectedPartyIds: string[];
  requiredEvidence: EvidenceReference[];
  requiredCapabilities: string[];
  ambiguityReasons: string[];
  contradictoryEvidenceEventIds: string[];
  risk: RiskLevel;
  confidence: number;
  freshness?: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface MissionDeliverable {
  id: string;
  description: string;
  artifactType: string;
  required: boolean;
}

export interface AcceptanceTest {
  id: string;
  description: string;
  verification: 'automatic' | 'manual';
  requiredEvidence: string[];
}

export interface ArtifactRequirement {
  type: string;
  description: string;
  schema?: JsonObject;
  verification: string[];
  requiredEvidence: string[];
}

export interface MissionTaskDefinition {
  id: string;
  kind: MissionTaskKind;
  title: string;
  description?: string;
  sequence: number;
  lane: AgentLane;
  selectedAgentId: string;
  capabilityIds: string[];
  requiredActions: string[];
  requiredTools: string[];
  model: string;
  maxTokens: number;
  writableScope: MissionPermissions;
  dependsOn: string[];
  evidenceEventIds: string[];
  expectedArtifact: ArtifactRequirement;
  externalAction?: ExternalActionSpec;
  input: JsonObject;
  estimatedCostMicroUsd: number;
  route: RouteType;
  risk: RiskLevel;
}

export interface AgentSelection {
  taskId: string;
  agentId: string;
  lane: AgentLane;
  capabilityIds: string[];
}

export interface MissionBudget {
  maxCostMicroUsd: number;
  maxRuntimeMs: number;
  maxConcurrency: number;
  maxRetriesPerAssignment: number;
}

export interface RepositoryGrant {
  repository: string;
  writablePaths: string[];
  mutationClasses: MutationClass[];
}

export interface MissionPermissions {
  allowedTools: string[];
  allowedSystems: string[];
  allowedRepositories: RepositoryGrant[];
  allowedChannels: string[];
  allowedRecipients: string[];
  allowedCredentialRefs: string[];
  allowedDataScopes: string[];
  allowedMutationClasses: MutationClass[];
}

export interface RollbackPlan {
  strategy: string;
  steps: string[];
  verification: string;
}

export interface MissionPlan {
  id: string;
  seriesId: string;
  version: number;
  supersedesPlanId?: string;
  intentId: string;
  title: string;
  objective: string;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  deliverables: MissionDeliverable[];
  acceptanceTests: AcceptanceTest[];
  evidenceEventIds: string[];
  contextSnapshotHash: string;
  taskGraph: MissionTaskDefinition[];
  selectedAgents: AgentSelection[];
  budget: MissionBudget;
  permissions: MissionPermissions;
  rollback: RollbackPlan;
  escalationConditions: EscalationReason[];
  planHash: string;
  approvalDecisionId?: string;
  approvedAt?: IsoTimestamp;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  cancelRequestedAt?: IsoTimestamp;
  freshness?: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface MissionTask {
  id: string;
  missionId: string;
  kind: MissionTaskKind;
  title: string;
  description?: string;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  sequence: number;
  lane: AgentLane;
  selectedAgentId: string;
  capabilityIds: string[];
  requiredActions: string[];
  requiredTools: string[];
  model: string;
  maxTokens: number;
  writableScope: MissionPermissions;
  requiredCapabilities: string[];
  dependsOn: string[];
  evidenceEventIds: string[];
  expectedArtifact: ArtifactRequirement;
  externalAction?: ExternalActionSpec;
  estimatedCostMicroUsd: number;
  input: JsonObject;
  output?: JsonValue;
  confidence?: number;
  freshness?: Freshness;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  integrityHash?: string;
}

export interface AgentCapability {
  id: string;
  agentId: string;
  lane: AgentLane;
  name: string;
  description?: string;
  status: LifecycleStatus;
  routes: RouteType[];
  supportedActions: string[];
  tools: string[];
  modelPolicy: ModelPolicy;
  writableScope: MissionPermissions;
  costClass: CostClass;
  mayCreateAssignments: boolean;
  maximumRisk: RiskLevel;
  confidence?: number;
  metadata: JsonObject;
  lastVerifiedAt?: IsoTimestamp;
  provenance: Provenance[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  integrityHash?: string;
}

export interface ModelPolicy {
  allowedModels: string[];
  preferredModel?: string;
  preferLocal: boolean;
  maxTokensPerAssignment: number;
}

export interface ExternalActionSpec {
  connectorId: string;
  action: string;
  destination: string;
  idempotencyKey: string;
  system?: string;
  channel?: string;
  recipient?: string;
  repository?: string;
  repositoryPath?: string;
  credentialRef?: string;
  dataScope?: string;
  tool?: string;
  mutationClass: MutationClass;
}

export interface Assignment {
  id: string;
  missionId: string;
  missionTaskId: string;
  agentId: string;
  capabilityIds: string[];
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  instructions: JsonObject;
  evidenceEventIds: string[];
  expectedArtifact: ArtifactRequirement;
  externalAction?: ExternalActionSpec;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  availableAt: IsoTimestamp;
  estimatedCostMicroUsd: number;
  artifact?: JsonValue;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: IsoTimestamp;
  cancelRequestedAt?: IsoTimestamp;
  cancelReason?: string;
  assignedAt: IsoTimestamp;
  acceptedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface Proposal {
  id: string;
  /** New proposals are version 1; optional only while reading pre-versioning local records. */
  version?: number;
  assignmentId?: string;
  missionTaskId?: string;
  proposedByAgentId: string;
  kind: ProposalKind;
  summary: string;
  body: JsonObject;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  createdAt: IsoTimestamp;
  expiresAt?: IsoTimestamp;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface ActionReceipt {
  id: string;
  proposalId?: string;
  assignmentId?: string;
  missionTaskId?: string;
  connectorId?: string;
  action: string;
  idempotencyKey: string;
  destination: string;
  status: ReceiptStatus;
  route: RouteType;
  risk: RiskLevel;
  requestedAt: IsoTimestamp;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  externalId?: string;
  verified: boolean;
  verifiedAt?: IsoTimestamp;
  evidenceEventIds: string[];
  attempt: number;
  result?: JsonValue;
  error?: JsonObject;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface DecisionRecord {
  id: string;
  intentId?: string;
  missionId?: string;
  missionTaskId?: string;
  proposalId?: string;
  preferenceChangeId?: string;
  decidedBy: string;
  outcome: DecisionOutcome;
  planHash?: string;
  planVersion?: number;
  /** Integrity binding for a human disposition of an immutable classifier intent. */
  intentHash?: string;
  /** Exact binding for a generic proposal decision. Checkpoints remain plan-bound. */
  proposalHash?: string;
  proposalVersion?: number;
  /** Exact binding for an atomic external-identity review disposition. */
  identityReviewId?: string;
  identityReviewFailureId?: string;
  identityReviewHash?: string;
  identityReviewVersion?: number;
  identityDisposition?: IdentityReviewDisposition;
  identitySelectedEntityId?: string;
  rationale: string;
  assumptions: string[];
  evidenceEventIds: string[];
  route: RouteType;
  risk: RiskLevel;
  confidence?: number;
  decidedAt: IsoTimestamp;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface ActionDescriptor {
  id: string;
  kind: CommandCenterActionKind;
  label: string;
  targetType: 'mission';
  targetId: string;
  method: 'POST';
  endpoint: string;
  enabled: boolean;
  requiresConfirmation: boolean;
  payload: {
    outcome: DecisionOutcome.Approved | DecisionOutcome.Rejected;
    planHash: string;
    version: number;
  };
  disabledReason?: string;
}

export interface CommandCenterEntityCard {
  id: string;
  entityType: EntityType;
  label: string;
  rank: number;
  status?: LifecycleStatus;
  risk?: RiskLevel;
  confidence?: number;
  freshness: Freshness;
  evidenceEventIds: string[];
  attributes: JsonObject;
  updatedAt: IsoTimestamp;
}

export interface CommandCenterToday {
  date: string;
  taskIds: string[];
  commitmentIds: string[];
  activeMissionIds: string[];
  pendingApprovalIds: string[];
}

export interface CommandCenterMissionTask {
  id: string;
  title: string;
  status: LifecycleStatus;
  sequence: number;
  dependsOn: string[];
  lane: AgentLane;
  agentId: string;
  capabilityIds: string[];
  estimatedCostMicroUsd: number;
  expectedArtifact: ArtifactRequirement;
  externalAction?: ExternalActionSpec;
}

export interface CommandCenterMissionBudget {
  limits: MissionBudget;
  plannedCostMicroUsd: number;
  recordedEstimatedCostMicroUsd: number;
  actualCostMicroUsd: number;
  elapsedRuntimeMs: number;
  activeAssignments: number;
  assignmentAttempts: number;
}

export interface CommandCenterTimelineEntry {
  id: string;
  kind: CommandCenterTimelineKind;
  occurredAt: IsoTimestamp;
  title: string;
  recordType: string;
  recordId: string;
  missionId?: string;
  status?: LifecycleStatus | ReceiptStatus;
  actor?: string;
  reason?: string;
  summary?: string;
  route?: IntentRoute | RouteType;
  routeRuleId?: string;
  risk?: RiskLevel;
  confidence?: number;
  planHash?: string;
  planVersion?: number;
  agentId?: string;
  artifactRecorded?: boolean;
  verification?: CommandCenterVerification;
  evidenceEventIds: string[];
  provenance: Provenance[];
  verified: boolean;
}

export interface CommandCenterMission {
  id: string;
  seriesId: string;
  version: number;
  planHash: string;
  title: string;
  objective: string;
  status: LifecycleStatus;
  stage: CommandCenterMissionStage;
  risk: RiskLevel;
  confidence?: number;
  taskGraph: CommandCenterMissionTask[];
  agents: AgentSelection[];
  budget: CommandCenterMissionBudget;
  acceptanceTests: AcceptanceTest[];
  escalationConditions: EscalationReason[];
  timeline: CommandCenterTimelineEntry[];
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface CommandCenterAffectedParty {
  entityId: string;
  label?: string;
  entityType?: EntityType;
}

export interface CommandCenterApproval {
  id: string;
  missionId: string;
  planHash: string;
  version: number;
  title: string;
  objective: string;
  risk: RiskLevel;
  affectedParties: CommandCenterAffectedParty[];
  affectedSystems: string[];
  externalActions: ExternalActionSpec[];
  deliverables: MissionDeliverable[];
  taskGraph: MissionTaskDefinition[];
  agents: AgentSelection[];
  budget: MissionBudget;
  permissions: MissionPermissions;
  escalationConditions: EscalationReason[];
  cost: {
    maximumMicroUsd: number;
    plannedMicroUsd: number;
    actualMicroUsd: number;
  };
  time: {
    maximumRuntimeMs: number;
    elapsedRuntimeMs: number;
  };
  acceptanceTests: AcceptanceTest[];
  rollback: RollbackPlan;
  actions: ActionDescriptor[];
}

export interface CommandCenterOutcome {
  id: string;
  missionId: string;
  missionTaskId: string;
  assignmentId: string;
  status: LifecycleStatus;
  artifact?: JsonValue;
  completedAt?: IsoTimestamp;
  evidenceEventIds: string[];
  receiptIds: string[];
  verified: boolean;
}

export interface NucleusNode {
  id: string;
  kind: NucleusNodeKind;
  recordType: string;
  recordId: string;
  label: string;
  entityType?: EntityType;
  status?: LifecycleStatus | ReceiptStatus;
  risk?: RiskLevel;
  updatedAt: IsoTimestamp;
  evidenceEventIds: string[];
  verified: true;
}

export interface NucleusEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
  evidenceEventIds: string[];
  verified: true;
}

export interface NucleusActivityPulse {
  id: string;
  kind: CommandCenterTimelineKind;
  occurredAt: IsoTimestamp;
  nodeId: string;
  edgeId?: string;
  label: string;
  evidenceEventIds: string[];
  verified: true;
}

export interface CommandCenterNucleus {
  nodes: NucleusNode[];
  edges: NucleusEdge[];
  activityPulses: NucleusActivityPulse[];
}

export enum KnowledgeSensitivity {
  Private = 'private',
  Internal = 'internal',
  Shared = 'shared',
}

export enum KnowledgeDestination {
  Obsidian = 'obsidian',
  Notion = 'notion',
}

export enum RetrievalCollection {
  PrivateVault = 'private_vault',
  CoreEvidence = 'core_evidence',
  SharedNotion = 'shared_notion',
}

export enum IndexLifecycleStatus {
  Candidate = 'candidate',
  Active = 'active',
  Superseded = 'superseded',
  Rejected = 'rejected',
  RolledBack = 'rolled_back',
}

export interface KnowledgeEvidenceSelector {
  eventId: string;
  selector?: string;
}

export interface KnowledgePackage {
  id: string;
  version: number;
  packageHash: string;
  missionId: string;
  planHash: string;
  title: string;
  objective: string;
  classification: string[];
  sensitivity: KnowledgeSensitivity;
  retentionPolicy: string;
  deliverables: string[];
  outcomeTaskIds: string[];
  decisionIds: string[];
  receiptIds: string[];
  decisions: Array<{ id: string; outcome: string; rationale: string; decidedBy: string; decidedAt: IsoTimestamp }>;
  outcomes: Array<{ taskId: string; status: string; completedAt: IsoTimestamp }>;
  receipts: Array<{ id: string; connectorId: string; action: string; destination: string; externalId: string }>;
  evidence: KnowledgeEvidenceSelector[];
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp;
}

export interface KnowledgeProjection {
  id: string;
  packageId: string;
  packageHash: string;
  destination: KnowledgeDestination;
  status: LifecycleStatus;
  approvedFieldNames: string[];
  redactedFieldNames: string[];
  createdAt: IsoTimestamp;
  approvedAt?: IsoTimestamp;
}

export interface ProjectionReceipt {
  id: string;
  projectionId: string;
  packageId: string;
  packageHash: string;
  destination: KnowledgeDestination;
  status: ReceiptStatus;
  relativePath?: string;
  externalId?: string;
  verified: boolean;
  attemptedAt: IsoTimestamp;
  verifiedAt?: IsoTimestamp;
}

export interface RetrievalResult {
  collection: RetrievalCollection;
  packageId?: string;
  packageVersion?: number;
  title: string;
  excerpt: string;
  source: string;
  evidence: KnowledgeEvidenceSelector[];
  freshness: Freshness;
  score: number;
}

export interface RetrievalMetrics {
  quality: number;
  freshness: number;
  latencyMs: number;
  duplicateRate: number;
  contradictionRate: number;
  evidenceCoverage: number;
}

export interface IndexVersion {
  id: string;
  collection: RetrievalCollection;
  version: number;
  status: IndexLifecycleStatus;
  configurationHash: string;
  metrics: RetrievalMetrics;
  createdAt: IsoTimestamp;
  promotedAt?: IsoTimestamp;
  supersedesId?: string;
}

export interface EvaluationRun {
  id: string;
  candidateIndexId: string;
  activeIndexId?: string;
  benchmarkVersion: string;
  candidateMetrics: RetrievalMetrics;
  baselineMetrics?: RetrievalMetrics;
  passed: boolean;
  privacyPassed: boolean;
  reasons: string[];
  completedAt: IsoTimestamp;
}

export interface PaperclipReconciliation {
  id: string;
  missionId: string;
  missionTaskId: string;
  assignmentId: string;
  planHash: string;
  idempotencyKey: string;
  status: LifecycleStatus;
  issueId?: string;
  observedStatus?: string;
  verifiedByCore: boolean;
  lastObservedAt: IsoTimestamp;
  error?: string;
}

export interface CommandCenterKnowledge {
  packages: KnowledgePackage[];
  projections: KnowledgeProjection[];
  projectionReceipts: ProjectionReceipt[];
  indexes: IndexVersion[];
  evaluations: EvaluationRun[];
  paperclip: PaperclipReconciliation[];
}

export interface CommandCenterSnapshot {
  revision: string;
  generatedAt: IsoTimestamp;
  today: CommandCenterToday;
  tasks: CommandCenterEntityCard[];
  communications: CommandCenterEntityCard[];
  people: CommandCenterEntityCard[];
  commitments: CommandCenterEntityCard[];
  missions: CommandCenterMission[];
  approvals: CommandCenterApproval[];
  proposals: Proposal[];
  activeAssignments: Assignment[];
  outcomes: CommandCenterOutcome[];
  receipts: ActionReceipt[];
  history: CommandCenterTimelineEntry[];
  connectors: ConnectorHealth[];
  captureFailures: CaptureFailure[];
  /** Persisted intents that safety routing held for explicit human review. */
  reviewIntents?: IntentEnvelope[];
  /** Persisted, source-backed external identity conflicts awaiting Carlos. */
  identityReviews?: ExternalIdentityReview[];
  lastChangeSequence: number;
  nucleus: CommandCenterNucleus;
  /** Typed projections replayed from the encrypted Core event ledger. */
  knowledge?: CommandCenterKnowledge;
}

export interface MissionDecisionRequest {
  outcome: DecisionOutcome.Approved | DecisionOutcome.Rejected;
  planHash: string;
  version: number;
  reason?: string;
}

export interface MissionDecisionResponse {
  decision: DecisionRecord;
  mission: CommandCenterMission;
  snapshot: CommandCenterSnapshot;
}

export interface ReviewIntentDecisionRequest {
  disposition: ReviewIntentDisposition;
  intentHash: string;
  reason?: string;
}

export interface ReviewIntentDecisionResponse {
  decision: DecisionRecord;
  originalIntent: IntentEnvelope;
  derivedIntent?: IntentEnvelope;
  /** A reclassification creates a fresh bounded plan, never queued work. */
  mission?: CommandCenterMission;
  snapshot: CommandCenterSnapshot;
}

export interface CheckpointDecisionRequest {
  outcome: DecisionOutcome.Approved | DecisionOutcome.Rejected;
  planHash: string;
  version: number;
  reason?: string;
}

export interface CheckpointDecisionResponse {
  decision: DecisionRecord;
  proposal: Proposal;
  assignment: Assignment;
  mission: CommandCenterMission;
  resumed: boolean;
  requiresNewPlan: boolean;
  snapshot: CommandCenterSnapshot;
}

export interface ProposalDecisionRequest {
  outcome: DecisionOutcome.Approved | DecisionOutcome.Rejected;
  proposalHash: string;
  version: number;
  reason?: string;
}

export interface ProposalDecisionResponse {
  decision: DecisionRecord;
  proposal: Proposal;
  /** Present only for the explicitly typed, source-backed create_relation effect. */
  relation?: Relation;
  snapshot: CommandCenterSnapshot;
}

export interface IdentityReviewDecisionRequest {
  disposition: IdentityReviewDisposition;
  reviewHash: string;
  version: number;
  targetEntityId?: string;
  reason?: string;
}

export interface IdentityReviewDecisionResponse {
  review: ExternalIdentityReview;
  decision: DecisionRecord;
  link: ExternalIdentityLink;
  sameAsRelation?: Relation;
  snapshot: CommandCenterSnapshot;
}

export interface ConnectorHealth {
  connectorId: string;
  status: ConnectorHealthStatus;
  checkedAt: IsoTimestamp;
  lastSuccessAt?: IsoTimestamp;
  lastFailureAt?: IsoTimestamp;
  latencyMs?: number;
  consecutiveFailures: number;
  freshness: Freshness;
  capabilities: ConnectorCapabilityHealth[];
  details: JsonObject;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface ConnectorCapabilityHealth {
  capability: ConnectorCapability;
  status: ConnectorHealthStatus;
  checkedAt: IsoTimestamp;
  lastSuccessAt?: IsoTimestamp;
  lastFailureAt?: IsoTimestamp;
  details: JsonObject;
}

export interface PreferenceChange {
  id: string;
  entityId?: string;
  scope: PreferenceScope;
  key: string;
  previousValue?: JsonValue;
  nextValue: JsonValue;
  status: LifecycleStatus;
  route: RouteType;
  risk: RiskLevel;
  source: string;
  sourceType: SourceType;
  changedAt: IsoTimestamp;
  reason?: string;
  provenance: Provenance[];
  integrityHash?: string;
}

export interface CostRecord {
  id: string;
  missionId: string;
  assignmentId?: string;
  category: CostCategory;
  provider?: string;
  model?: string;
  tool?: string;
  estimatedMicroUsd: number;
  actualMicroUsd: number;
  idempotencyKey: string;
  incurredAt: IsoTimestamp;
  provenance: Provenance[];
  integrityHash?: string;
}

export function assertEventEnvelope(value: unknown): asserts value is EventEnvelope {
  if (!isRecord(value)) {
    throw new TypeError('Event envelope must be an object');
  }
  if (!isJsonValue(value.payload)) {
    throw new TypeError('Event envelope payload must be JSON-serializable');
  }
  for (const field of ['id', 'source', 'sourceEventId', 'type']) {
    assertNonEmptyString(value[field], `Event envelope ${field}`);
  }
  assertEnum(value.sourceType, SourceType, 'Event envelope sourceType');
  assertTimestamp(value.occurredAt, 'Event envelope occurredAt');
  assertTimestamp(value.ingestedAt, 'Event envelope ingestedAt');
  assertOptionalEnum(value, 'status', LifecycleStatus, 'Event envelope status');
  assertOptionalEnum(value, 'route', RouteType, 'Event envelope route');
  assertOptionalEnum(value, 'risk', RiskLevel, 'Event envelope risk');
  assertOptionalConfidence(value, 'confidence', 'Event envelope confidence');
  if ('freshness' in value) {
    assertFreshness(value.freshness, 'Event envelope freshness');
  }
  assertProvenanceList(value.provenance, 'Event envelope provenance');
  assertOptionalIntegrityHash(value, 'Event envelope integrityHash');
  if (!isJsonValue(value)) {
    throw new TypeError('Event envelope must contain only JSON values');
  }
}

export function assertVersionedCursor(value: unknown): asserts value is VersionedCursor {
  assertRecord(value, 'Connector cursor');
  for (const field of ['connectorId', 'partition']) {
    assertNonEmptyString(value[field], `Connector cursor ${field}`);
  }
  assertEnum(value.capability, ConnectorCapability, 'Connector cursor capability');
  assertNonNegativeInteger(value.epoch, 'Connector cursor epoch');
  assertNonNegativeInteger(value.sequence, 'Connector cursor sequence');
  assertNonNegativeInteger(value.version, 'Connector cursor version');
  for (const field of ['pageToken']) {
    if (field in value) assertNonEmptyString(value[field], `Connector cursor ${field}`);
  }
  for (const field of ['watermark', 'overlapFrom', 'updatedAt']) {
    if (field === 'updatedAt' || field in value) {
      assertTimestamp(value[field], `Connector cursor ${field}`);
    }
  }
  assertOptionalIntegrityHash(value, 'Connector cursor integrityHash');
  assertJsonOnly(value, 'Connector cursor');
}

export function assertExternalIdentityObservation(
  value: unknown,
): asserts value is ExternalIdentityObservation {
  assertRecord(value, 'External identity observation');
  for (const field of ['connectorId', 'namespace', 'externalId', 'evidenceEventId']) {
    assertNonEmptyString(value[field], `External identity observation ${field}`);
  }
  if ('displayName' in value) {
    assertNonEmptyString(value.displayName, 'External identity observation displayName');
  }
  if ('claimedEntityId' in value) {
    assertNonEmptyString(value.claimedEntityId, 'External identity observation claimedEntityId');
  }
  assertEnum(value.entityType, EntityType, 'External identity observation entityType');
  assertJsonObject(value.attributes, 'External identity observation attributes');
  assertTimestamp(value.observedAt, 'External identity observation observedAt');
  assertRequiredConfidence(value.confidence, 'External identity observation confidence');
  assertJsonOnly(value, 'External identity observation');
}

export function assertExternalRelationObservation(
  value: unknown,
): asserts value is ExternalRelationObservation {
  assertRecord(value, 'External relation observation');
  for (const [name, key] of [['from', value.from], ['to', value.to]] as const) {
    assertRecord(key, `External relation observation ${name}`);
    for (const field of ['connectorId', 'namespace', 'externalId']) {
      assertNonEmptyString(key[field], `External relation observation ${name}.${field}`);
    }
  }
  assertEnum(value.type, RelationType, 'External relation observation type');
  assertJsonObject(value.attributes, 'External relation observation attributes');
  assertTimestamp(value.observedAt, 'External relation observation observedAt');
  assertNonEmptyString(value.evidenceEventId, 'External relation observation evidenceEventId');
  assertJsonOnly(value, 'External relation observation');
}

export function assertExternalIdentityLink(value: unknown): asserts value is ExternalIdentityLink {
  assertRecord(value, 'External identity link');
  for (const field of ['id', 'connectorId', 'namespace', 'externalId', 'entityId']) {
    assertNonEmptyString(value[field], `External identity link ${field}`);
  }
  assertEnum(value.status, ExternalIdentityLinkStatus, 'External identity link status');
  assertTimestamp(value.firstObservedAt, 'External identity link firstObservedAt');
  assertTimestamp(value.lastObservedAt, 'External identity link lastObservedAt');
  assertDenseStringArray(value.evidenceEventIds, 'External identity link evidenceEventIds');
  assertRequiredConfidence(value.confidence, 'External identity link confidence');
  assertProvenanceList(value.provenance, 'External identity link provenance');
  assertOptionalIntegrityHash(value, 'External identity link integrityHash');
  assertJsonOnly(value, 'External identity link');
}

export function assertExternalIdentityReviewCandidate(
  value: unknown,
): asserts value is ExternalIdentityReviewCandidate {
  assertRecord(value, 'External identity review candidate');
  for (const field of ['id', 'connectorId', 'namespace', 'externalId', 'observedEntityId', 'reason']) {
    assertNonEmptyString(value[field], `External identity review candidate ${field}`);
  }
  assertEnum(value.kind, IdentityReviewKind, 'External identity review candidate kind');
  assertDenseStringArray(value.candidateEntityIds, 'External identity review candidate candidateEntityIds');
  assertEnum(value.status, LifecycleStatus, 'External identity review candidate status');
  assertEnum(value.route, RouteType, 'External identity review candidate route');
  assertEnum(value.risk, RiskLevel, 'External identity review candidate risk');
  assertDenseStringArray(value.evidenceEventIds, 'External identity review candidate evidenceEventIds');
  assertTimestamp(value.createdAt, 'External identity review candidate createdAt');
  assertProvenanceList(value.provenance, 'External identity review candidate provenance');
  assertJsonOnly(value, 'External identity review candidate');
}

export function assertExternalIdentityReview(value: unknown): asserts value is ExternalIdentityReview {
  assertRecord(value, 'External identity review');
  for (const field of ['id', 'failureId', 'linkId', 'reviewHash', 'connectorId', 'namespace', 'reason']) {
    assertNonEmptyString(value[field], `External identity review ${field}`);
  }
  assertPositiveInteger(value.version, 'External identity review version');
  assertDigest(value.reviewHash, 'External identity review reviewHash');
  assertEnum(value.kind, IdentityReviewKind, 'External identity review kind');
  assertIdentityReviewEntity(value.observedEntity, 'External identity review observedEntity');
  if (!Array.isArray(value.candidateEntities)) {
    throw new TypeError('External identity review candidateEntities must be an array');
  }
  value.candidateEntities.forEach((candidate, index) =>
    assertIdentityReviewEntity(candidate, `External identity review candidateEntities[${index}]`));
  assertEnum(value.status, LifecycleStatus, 'External identity review status');
  assertEnum(value.route, RouteType, 'External identity review route');
  assertEnum(value.risk, RiskLevel, 'External identity review risk');
  assertDenseStringArray(value.evidenceEventIds, 'External identity review evidenceEventIds');
  assertEvidenceList(value.evidence, 'External identity review evidence');
  assertTimestamp(value.createdAt, 'External identity review createdAt');
  assertProvenanceList(value.provenance, 'External identity review provenance');
  if ('decision' in value) assertDecisionRecord(value.decision);
  assertJsonOnly(value, 'External identity review');
}

export function assertCaptureFailure(value: unknown): asserts value is CaptureFailure {
  assertRecord(value, 'Capture failure');
  for (const field of ['id', 'connectorId', 'message']) {
    assertNonEmptyString(value[field], `Capture failure ${field}`);
  }
  if ('sourceEventId' in value) assertNonEmptyString(value.sourceEventId, 'Capture failure sourceEventId');
  assertEnum(value.capability, ConnectorCapability, 'Capture failure capability');
  assertEnum(value.kind, CaptureFailureKind, 'Capture failure kind');
  if (typeof value.retryable !== 'boolean') throw new TypeError('Capture failure retryable must be boolean');
  assertEnum(value.status, LifecycleStatus, 'Capture failure status');
  assertEnum(value.route, RouteType, 'Capture failure route');
  assertEnum(value.risk, RiskLevel, 'Capture failure risk');
  assertJsonObject(value.details, 'Capture failure details');
  if ('reviewCandidate' in value) assertExternalIdentityReviewCandidate(value.reviewCandidate);
  assertTimestamp(value.occurredAt, 'Capture failure occurredAt');
  assertProvenanceList(value.provenance, 'Capture failure provenance');
  assertOptionalIntegrityHash(value, 'Capture failure integrityHash');
  assertJsonOnly(value, 'Capture failure');
}

export function assertNormalizedCapture(value: unknown): asserts value is NormalizedCapture {
  assertRecord(value, 'Normalized capture');
  assertEventEnvelope(value.event);
  if (!Array.isArray(value.identities)) throw new TypeError('Normalized capture identities must be an array');
  value.identities.forEach(assertExternalIdentityObservation);
  if (!Array.isArray(value.relations)) throw new TypeError('Normalized capture relations must be an array');
  value.relations.forEach(assertExternalRelationObservation);
  assertJsonOnly(value, 'Normalized capture');
}

export function assertChangeLog(value: unknown): asserts value is ChangeLog {
  assertRecord(value, 'Change log');
  for (const field of ['id', 'recordType', 'recordId']) {
    assertNonEmptyString(value[field], `Change log ${field}`);
  }
  if ('connectorId' in value) assertNonEmptyString(value.connectorId, 'Change log connectorId');
  if ('eventId' in value) assertNonEmptyString(value.eventId, 'Change log eventId');
  assertPositiveInteger(value.sequence, 'Change log sequence');
  assertEnum(value.kind, ChangeLogKind, 'Change log kind');
  assertTimestamp(value.changedAt, 'Change log changedAt');
  assertJsonObject(value.payload, 'Change log payload');
  assertOptionalIntegrityHash(value, 'Change log integrityHash');
  assertJsonOnly(value, 'Change log');
}

export function assertConnectorLease(value: unknown): asserts value is ConnectorLease {
  assertRecord(value, 'Connector lease');
  for (const field of ['id', 'connectorId', 'ownerId', 'leaseToken']) {
    assertNonEmptyString(value[field], `Connector lease ${field}`);
  }
  assertEnum(value.capability, ConnectorCapability, 'Connector lease capability');
  assertTimestamp(value.expiresAt, 'Connector lease expiresAt');
  assertPositiveInteger(value.version, 'Connector lease version');
  assertTimestamp(value.updatedAt, 'Connector lease updatedAt');
  assertOptionalIntegrityHash(value, 'Connector lease integrityHash');
  assertJsonOnly(value, 'Connector lease');
}

export function assertEntity(value: unknown): asserts value is Entity {
  if (!isRecord(value)) {
    throw new TypeError('Entity must be an object');
  }
  for (const field of ['id', 'canonicalName']) {
    assertNonEmptyString(value[field], `Entity ${field}`);
  }
  assertEnum(value.type, EntityType, 'Entity type');
  assertDenseStringArray(value.aliases, 'Entity aliases');
  assertJsonObject(value.attributes, 'Entity attributes');
  assertOptionalEnum(value, 'status', LifecycleStatus, 'Entity status');
  assertOptionalEnum(value, 'risk', RiskLevel, 'Entity risk');
  assertOptionalConfidence(value, 'confidence', 'Entity confidence');
  assertFreshness(value.freshness, 'Entity freshness');
  assertProvenanceList(value.provenance, 'Entity provenance');
  assertTimestamp(value.createdAt, 'Entity createdAt');
  assertTimestamp(value.updatedAt, 'Entity updatedAt');
  assertOptionalIntegrityHash(value, 'Entity integrityHash');
  if (!isJsonValue(value)) {
    throw new TypeError('Entity must contain only JSON values');
  }
}

export function assertRelation(value: unknown): asserts value is Relation {
  if (!isRecord(value)) {
    throw new TypeError('Relation must be an object');
  }
  for (const field of ['id', 'fromEntityId', 'toEntityId']) {
    assertNonEmptyString(value[field], `Relation ${field}`);
  }
  assertEnum(value.type, RelationType, 'Relation type');
  assertJsonObject(value.attributes, 'Relation attributes');
  assertOptionalEnum(value, 'status', LifecycleStatus, 'Relation status');
  assertOptionalEnum(value, 'risk', RiskLevel, 'Relation risk');
  assertOptionalConfidence(value, 'confidence', 'Relation confidence');
  assertFreshness(value.freshness, 'Relation freshness');
  assertProvenanceList(value.provenance, 'Relation provenance');
  assertTimestamp(value.createdAt, 'Relation createdAt');
  assertTimestamp(value.updatedAt, 'Relation updatedAt');
  assertOptionalIntegrityHash(value, 'Relation integrityHash');
  if (!isJsonValue(value)) {
    throw new TypeError('Relation must contain only JSON values');
  }
}

export function assertConnectorHealth(
  value: unknown,
): asserts value is ConnectorHealth {
  if (!isRecord(value)) {
    throw new TypeError('Connector health must be an object');
  }
  assertNonEmptyString(value.connectorId, 'Connector health connectorId');
  assertEnum(value.status, ConnectorHealthStatus, 'Connector health status');
  assertTimestamp(value.checkedAt, 'Connector health checkedAt');
  for (const field of ['lastSuccessAt', 'lastFailureAt']) {
    if (field in value) {
      assertTimestamp(value[field], `Connector health ${field}`);
    }
  }
  if (
    'latencyMs' in value &&
    (typeof value.latencyMs !== 'number' ||
      !Number.isFinite(value.latencyMs) ||
      value.latencyMs < 0)
  ) {
    throw new TypeError('Connector health latencyMs must be finite and non-negative');
  }
  if (
    !Number.isInteger(value.consecutiveFailures) ||
    Number(value.consecutiveFailures) < 0
  ) {
    throw new TypeError(
      'Connector health consecutiveFailures must be a non-negative integer',
    );
  }
  assertFreshness(value.freshness, 'Connector health freshness');
  if (!Array.isArray(value.capabilities)) {
    throw new TypeError('Connector health capabilities must be an array');
  }
  for (const capability of value.capabilities) {
    assertRecord(capability, 'Connector capability health');
    assertEnum(capability.capability, ConnectorCapability, 'Connector capability health capability');
    assertEnum(capability.status, ConnectorHealthStatus, 'Connector capability health status');
    assertTimestamp(capability.checkedAt, 'Connector capability health checkedAt');
    for (const field of ['lastSuccessAt', 'lastFailureAt']) {
      if (field in capability) assertTimestamp(capability[field], `Connector capability health ${field}`);
    }
    assertJsonObject(capability.details, 'Connector capability health details');
  }
  assertJsonObject(value.details, 'Connector health details');
  assertProvenanceList(value.provenance, 'Connector health provenance');
  assertOptionalIntegrityHash(value, 'Connector health integrityHash');
  if (!isJsonValue(value)) {
    throw new TypeError('Connector health must contain only JSON values');
  }
}

export function assertIntentEnvelope(value: unknown): asserts value is IntentEnvelope {
  assertRecord(value, 'Intent');
  for (const field of ['id', 'source', 'summary', 'routeRuleId']) {
    assertNonEmptyString(value[field], `Intent ${field}`);
  }
  if ('eventId' in value) assertNonEmptyString(value.eventId, 'Intent eventId');
  if ('actorEntityId' in value) assertNonEmptyString(value.actorEntityId, 'Intent actorEntityId');
  assertEnum(value.sourceType, SourceType, 'Intent sourceType');
  assertEnum(value.kind, IntentKind, 'Intent kind');
  assertJsonObject(value.payload, 'Intent payload');
  assertEnum(value.status, LifecycleStatus, 'Intent status');
  assertEnum(value.route, IntentRoute, 'Intent route');
  assertEnum(value.risk, RiskLevel, 'Intent risk');
  assertRequiredConfidence(value.confidence, 'Intent confidence');
  for (const field of ['entityIds', 'affectedPartyIds', 'requiredCapabilities', 'ambiguityReasons', 'contradictoryEvidenceEventIds']) {
    assertDenseStringArray(value[field], `Intent ${field}`);
  }
  if ('expectedOutcome' in value) assertNonEmptyString(value.expectedOutcome, 'Intent expectedOutcome');
  assertStatementList(value.commitments, 'Intent commitments');
  assertStatementList(value.claims, 'Intent claims');
  assertStatementList(value.assumptions, 'Intent assumptions');
  assertDeadlineList(value.deadlines, 'Intent deadlines');
  assertEvidenceList(value.requiredEvidence, 'Intent requiredEvidence');
  if ('freshness' in value) assertFreshness(value.freshness, 'Intent freshness');
  assertProvenanceList(value.provenance, 'Intent provenance');
  assertTimestamp(value.createdAt, 'Intent createdAt');
  assertTimestamp(value.updatedAt, 'Intent updatedAt');
  assertOptionalIntegrityHash(value, 'Intent integrityHash');
  assertJsonOnly(value, 'Intent');
}

export function assertMissionPlan(value: unknown): asserts value is MissionPlan {
  assertRecord(value, 'Mission');
  for (const field of ['id', 'seriesId', 'intentId', 'title', 'objective', 'contextSnapshotHash', 'planHash']) {
    assertNonEmptyString(value[field], `Mission ${field}`);
  }
  assertDigest(value.contextSnapshotHash, 'Mission contextSnapshotHash');
  assertDigest(value.planHash, 'Mission planHash');
  assertPositiveInteger(value.version, 'Mission version');
  if ('supersedesPlanId' in value) assertNonEmptyString(value.supersedesPlanId, 'Mission supersedesPlanId');
  assertEnum(value.status, LifecycleStatus, 'Mission status');
  assertEnum(value.route, RouteType, 'Mission route');
  assertEnum(value.risk, RiskLevel, 'Mission risk');
  assertOptionalConfidence(value, 'confidence', 'Mission confidence');
  assertDeliverableList(value.deliverables, 'Mission deliverables');
  assertAcceptanceTestList(value.acceptanceTests, 'Mission acceptanceTests');
  assertDenseStringArray(value.evidenceEventIds, 'Mission evidenceEventIds');
  assertMissionTaskDefinitionList(value.taskGraph, 'Mission taskGraph');
  assertAgentSelectionList(value.selectedAgents, 'Mission selectedAgents');
  assertJsonObject(value.budget, 'Mission budget');
  assertNonNegativeInteger(value.budget.maxCostMicroUsd, 'Mission maxCostMicroUsd');
  assertPositiveInteger(value.budget.maxRuntimeMs, 'Mission maxRuntimeMs');
  assertPositiveInteger(value.budget.maxConcurrency, 'Mission maxConcurrency');
  assertNonNegativeInteger(value.budget.maxRetriesPerAssignment, 'Mission maxRetriesPerAssignment');
  assertPermissions(value.permissions, 'Mission permissions');
  assertJsonObject(value.rollback, 'Mission rollback');
  assertNonEmptyString(value.rollback.strategy, 'Mission rollback strategy');
  assertDenseStringArray(value.rollback.steps, 'Mission rollback steps');
  assertNonEmptyString(value.rollback.verification, 'Mission rollback verification');
  assertDenseEnumArray(value.escalationConditions, EscalationReason, 'Mission escalationConditions');
  for (const field of ['approvalDecisionId']) {
    if (field in value) assertNonEmptyString(value[field], `Mission ${field}`);
  }
  for (const field of ['approvedAt', 'startedAt', 'completedAt', 'cancelRequestedAt']) {
    if (field in value) assertTimestamp(value[field], `Mission ${field}`);
  }
  if ('freshness' in value) assertFreshness(value.freshness, 'Mission freshness');
  assertProvenanceList(value.provenance, 'Mission provenance');
  assertTimestamp(value.createdAt, 'Mission createdAt');
  assertTimestamp(value.updatedAt, 'Mission updatedAt');
  assertOptionalIntegrityHash(value, 'Mission integrityHash');
  assertJsonOnly(value, 'Mission');
}

export function assertMissionTask(value: unknown): asserts value is MissionTask {
  assertRecord(value, 'Mission task');
  for (const field of ['id', 'missionId', 'title', 'selectedAgentId']) {
    assertNonEmptyString(value[field], `Mission task ${field}`);
  }
  assertEnum(value.kind, MissionTaskKind, 'Mission task kind');
  assertEnum(value.status, LifecycleStatus, 'Mission task status');
  assertEnum(value.route, RouteType, 'Mission task route');
  assertEnum(value.risk, RiskLevel, 'Mission task risk');
  assertEnum(value.lane, AgentLane, 'Mission task lane');
  assertNonNegativeInteger(value.sequence, 'Mission task sequence');
  assertNonNegativeInteger(value.estimatedCostMicroUsd, 'Mission task estimatedCostMicroUsd');
  assertNonEmptyString(value.model, 'Mission task model');
  assertPositiveInteger(value.maxTokens, 'Mission task maxTokens');
  for (const field of ['capabilityIds', 'requiredActions', 'requiredTools', 'requiredCapabilities', 'dependsOn', 'evidenceEventIds']) {
    assertDenseStringArray(value[field], `Mission task ${field}`);
  }
  assertPermissions(value.writableScope, 'Mission task writableScope');
  assertArtifactRequirement(value.expectedArtifact, 'Mission task expectedArtifact');
  if ('externalAction' in value) assertExternalAction(value.externalAction, 'Mission task externalAction');
  assertJsonObject(value.input, 'Mission task input');
  if ('output' in value && !isJsonValue(value.output)) throw new TypeError('Mission task output must be JSON');
  assertOptionalConfidence(value, 'confidence', 'Mission task confidence');
  if ('freshness' in value) assertFreshness(value.freshness, 'Mission task freshness');
  assertProvenanceList(value.provenance, 'Mission task provenance');
  for (const field of ['createdAt', 'updatedAt', 'startedAt', 'completedAt']) {
    if (field in value) assertTimestamp(value[field], `Mission task ${field}`);
  }
  assertOptionalIntegrityHash(value, 'Mission task integrityHash');
  assertJsonOnly(value, 'Mission task');
}

export function assertAgentCapability(value: unknown): asserts value is AgentCapability {
  assertRecord(value, 'Agent capability');
  for (const field of ['id', 'agentId', 'name']) assertNonEmptyString(value[field], `Agent capability ${field}`);
  assertEnum(value.lane, AgentLane, 'Agent capability lane');
  assertEnum(value.status, LifecycleStatus, 'Agent capability status');
  assertDenseEnumArray(value.routes, RouteType, 'Agent capability routes');
  assertDenseStringArray(value.supportedActions, 'Agent capability supportedActions');
  assertDenseStringArray(value.tools, 'Agent capability tools');
  assertModelPolicy(value.modelPolicy, 'Agent capability modelPolicy');
  assertPermissions(value.writableScope, 'Agent capability writableScope');
  assertEnum(value.costClass, CostClass, 'Agent capability costClass');
  if (typeof value.mayCreateAssignments !== 'boolean') throw new TypeError('Agent capability mayCreateAssignments must be boolean');
  assertEnum(value.maximumRisk, RiskLevel, 'Agent capability maximumRisk');
  assertOptionalConfidence(value, 'confidence', 'Agent capability confidence');
  assertJsonObject(value.metadata, 'Agent capability metadata');
  if ('lastVerifiedAt' in value) assertTimestamp(value.lastVerifiedAt, 'Agent capability lastVerifiedAt');
  assertProvenanceList(value.provenance, 'Agent capability provenance');
  assertTimestamp(value.createdAt, 'Agent capability createdAt');
  assertTimestamp(value.updatedAt, 'Agent capability updatedAt');
  assertOptionalIntegrityHash(value, 'Agent capability integrityHash');
  assertJsonOnly(value, 'Agent capability');
}

export function assertAssignment(value: unknown): asserts value is Assignment {
  assertRecord(value, 'Assignment');
  for (const field of ['id', 'missionId', 'missionTaskId', 'agentId', 'idempotencyKey']) {
    assertNonEmptyString(value[field], `Assignment ${field}`);
  }
  assertDenseStringArray(value.capabilityIds, 'Assignment capabilityIds');
  assertEnum(value.status, LifecycleStatus, 'Assignment status');
  assertEnum(value.route, RouteType, 'Assignment route');
  assertEnum(value.risk, RiskLevel, 'Assignment risk');
  assertOptionalConfidence(value, 'confidence', 'Assignment confidence');
  assertJsonObject(value.instructions, 'Assignment instructions');
  assertDenseStringArray(value.evidenceEventIds, 'Assignment evidenceEventIds');
  assertArtifactRequirement(value.expectedArtifact, 'Assignment expectedArtifact');
  if ('externalAction' in value) assertExternalAction(value.externalAction, 'Assignment externalAction');
  assertNonNegativeInteger(value.attempt, 'Assignment attempt');
  assertPositiveInteger(value.maxAttempts, 'Assignment maxAttempts');
  assertNonNegativeInteger(value.estimatedCostMicroUsd, 'Assignment estimatedCostMicroUsd');
  if ('artifact' in value && !isJsonValue(value.artifact)) throw new TypeError('Assignment artifact must be JSON');
  for (const field of ['leaseOwner', 'leaseToken', 'cancelReason']) {
    if (field in value) assertNonEmptyString(value[field], `Assignment ${field}`);
  }
  for (const field of ['availableAt', 'leaseExpiresAt', 'cancelRequestedAt', 'assignedAt', 'acceptedAt', 'completedAt']) {
    if (field in value) assertTimestamp(value[field], `Assignment ${field}`);
  }
  assertProvenanceList(value.provenance, 'Assignment provenance');
  assertOptionalIntegrityHash(value, 'Assignment integrityHash');
  assertJsonOnly(value, 'Assignment');
}

export function assertProposal(value: unknown): asserts value is Proposal {
  assertRecord(value, 'Proposal');
  for (const field of ['id', 'proposedByAgentId', 'summary']) assertNonEmptyString(value[field], `Proposal ${field}`);
  for (const field of ['assignmentId', 'missionTaskId']) if (field in value) assertNonEmptyString(value[field], `Proposal ${field}`);
  assertEnum(value.kind, ProposalKind, 'Proposal kind');
  assertJsonObject(value.body, 'Proposal body');
  if ('version' in value) assertPositiveInteger(value.version, 'Proposal version');
  assertEnum(value.status, LifecycleStatus, 'Proposal status');
  assertEnum(value.route, RouteType, 'Proposal route');
  assertEnum(value.risk, RiskLevel, 'Proposal risk');
  assertOptionalConfidence(value, 'confidence', 'Proposal confidence');
  assertTimestamp(value.createdAt, 'Proposal createdAt');
  if ('expiresAt' in value) assertTimestamp(value.expiresAt, 'Proposal expiresAt');
  assertProvenanceList(value.provenance, 'Proposal provenance');
  assertOptionalIntegrityHash(value, 'Proposal integrityHash');
  assertJsonOnly(value, 'Proposal');
}

export function assertActionReceipt(value: unknown): asserts value is ActionReceipt {
  assertRecord(value, 'Receipt');
  for (const field of ['id', 'action', 'idempotencyKey', 'destination']) assertNonEmptyString(value[field], `Receipt ${field}`);
  for (const field of ['proposalId', 'assignmentId', 'missionTaskId', 'connectorId', 'externalId']) {
    if (field in value) assertNonEmptyString(value[field], `Receipt ${field}`);
  }
  assertEnum(value.status, ReceiptStatus, 'Receipt status');
  assertEnum(value.route, RouteType, 'Receipt route');
  assertEnum(value.risk, RiskLevel, 'Receipt risk');
  if (typeof value.verified !== 'boolean') throw new TypeError('Receipt verified must be boolean');
  assertDenseStringArray(value.evidenceEventIds, 'Receipt evidenceEventIds');
  assertPositiveInteger(value.attempt, 'Receipt attempt');
  for (const field of ['requestedAt', 'startedAt', 'completedAt', 'verifiedAt']) if (field in value) assertTimestamp(value[field], `Receipt ${field}`);
  if ('result' in value && !isJsonValue(value.result)) throw new TypeError('Receipt result must be JSON');
  if ('error' in value) assertJsonObject(value.error, 'Receipt error');
  assertProvenanceList(value.provenance, 'Receipt provenance');
  assertOptionalIntegrityHash(value, 'Receipt integrityHash');
  assertJsonOnly(value, 'Receipt');
}

export function assertDecisionRecord(value: unknown): asserts value is DecisionRecord {
  assertRecord(value, 'Decision');
  for (const field of ['id', 'decidedBy', 'rationale']) assertNonEmptyString(value[field], `Decision ${field}`);
  for (const field of ['intentId', 'missionId', 'missionTaskId', 'proposalId', 'preferenceChangeId']) if (field in value) assertNonEmptyString(value[field], `Decision ${field}`);
  if ('planHash' in value) assertDigest(value.planHash, 'Decision planHash');
  if ('planVersion' in value) assertPositiveInteger(value.planVersion, 'Decision planVersion');
  if ('intentHash' in value) assertDigest(value.intentHash, 'Decision intentHash');
  const proposalBindingFields = ['proposalHash', 'proposalVersion'] as const;
  const proposalBindingCount = proposalBindingFields.filter((field) => field in value).length;
  if (proposalBindingCount !== 0 && proposalBindingCount !== proposalBindingFields.length) {
    throw new TypeError('Decision proposal binding must be complete');
  }
  if (proposalBindingCount > 0) {
    assertDigest(value.proposalHash, 'Decision proposalHash');
    assertPositiveInteger(value.proposalVersion, 'Decision proposalVersion');
  }
  const identityFields = [
    'identityReviewId',
    'identityReviewFailureId',
    'identityReviewHash',
    'identityReviewVersion',
    'identityDisposition',
    'identitySelectedEntityId',
  ] as const;
  const identityFieldCount = identityFields.filter((field) => field in value).length;
  if (identityFieldCount !== 0 && identityFieldCount !== identityFields.length) {
    throw new TypeError('Decision identity review binding must be complete');
  }
  if (identityFieldCount > 0) {
    assertNonEmptyString(value.identityReviewId, 'Decision identityReviewId');
    assertNonEmptyString(value.identityReviewFailureId, 'Decision identityReviewFailureId');
    assertDigest(value.identityReviewHash, 'Decision identityReviewHash');
    assertPositiveInteger(value.identityReviewVersion, 'Decision identityReviewVersion');
    assertEnum(value.identityDisposition, IdentityReviewDisposition, 'Decision identityDisposition');
    assertNonEmptyString(value.identitySelectedEntityId, 'Decision identitySelectedEntityId');
  }
  assertEnum(value.outcome, DecisionOutcome, 'Decision outcome');
  assertDenseStringArray(value.assumptions, 'Decision assumptions');
  assertDenseStringArray(value.evidenceEventIds, 'Decision evidenceEventIds');
  assertEnum(value.route, RouteType, 'Decision route');
  assertEnum(value.risk, RiskLevel, 'Decision risk');
  assertOptionalConfidence(value, 'confidence', 'Decision confidence');
  assertTimestamp(value.decidedAt, 'Decision decidedAt');
  assertProvenanceList(value.provenance, 'Decision provenance');
  assertOptionalIntegrityHash(value, 'Decision integrityHash');
  assertJsonOnly(value, 'Decision');
}

export function assertPreferenceChange(value: unknown): asserts value is PreferenceChange {
  assertRecord(value, 'Preference change');
  for (const field of ['id', 'key', 'source']) assertNonEmptyString(value[field], `Preference change ${field}`);
  if ('entityId' in value) assertNonEmptyString(value.entityId, 'Preference change entityId');
  assertEnum(value.scope, PreferenceScope, 'Preference change scope');
  if ('previousValue' in value && !isJsonValue(value.previousValue)) throw new TypeError('Preference previousValue must be JSON');
  if (!isJsonValue(value.nextValue)) throw new TypeError('Preference nextValue must be JSON');
  assertEnum(value.status, LifecycleStatus, 'Preference change status');
  assertEnum(value.route, RouteType, 'Preference change route');
  assertEnum(value.risk, RiskLevel, 'Preference change risk');
  assertEnum(value.sourceType, SourceType, 'Preference change sourceType');
  assertTimestamp(value.changedAt, 'Preference change changedAt');
  if ('reason' in value) assertNonEmptyString(value.reason, 'Preference change reason');
  assertProvenanceList(value.provenance, 'Preference change provenance');
  assertOptionalIntegrityHash(value, 'Preference change integrityHash');
  assertJsonOnly(value, 'Preference change');
}

export function assertGroundedResultEvent(value: unknown): asserts value is GroundedResultEvent {
  assertRecord(value, 'GroundedResultEvent');
  assertNonEmptyString(value.resultId, 'resultId');
  const validPhases = ['retrieving', 'resolved', 'ambiguous', 'unavailable'];
  if (!validPhases.includes(String(value.phase))) throw new TypeError('GroundedResultEvent phase is invalid');
  const validRoutes = ['private_knowledge', 'core_operational', 'general', 'clarification'];
  if (!validRoutes.includes(String(value.route))) throw new TypeError('GroundedResultEvent route is invalid');
  assertNonEmptyString(value.subject, 'subject');
  const validConfidences = ['strong', 'partial', 'ambiguous', 'none'];
  if (!validConfidences.includes(String(value.confidence))) throw new TypeError('GroundedResultEvent confidence is invalid');
  for (const key of ['canonicalIdentity', 'fullName', 'relationship']) {
    if (key in value && typeof value[key] !== 'undefined') assertNonEmptyString(value[key], key);
  }
  if (Array.isArray(value.employment)) {
    value.employment.forEach((item: unknown, index: number) => assertNonEmptyString(item, `employment[${index}]`));
  } else if ('employment' in value) {
    throw new TypeError('GroundedResultEvent employment must be an array');
  }
  assertGroundedResultProvenanceList(value.provenance, 'provenance');
  assertRecord(value.actions, 'actions');
  if (typeof value.retrievalCount !== 'number' || !Number.isInteger(value.retrievalCount) || value.retrievalCount < 0) {
    throw new TypeError('GroundedResultEvent retrievalCount must be a non-negative integer');
  }
  if (value.guided !== undefined) {
    assertRecord(value.guided, 'guided');
    if (value.guided.test !== 'isabella') throw new TypeError('GroundedResultEvent guided.test must be isabella');
  }
}

function assertGroundedResultProvenanceList(value: unknown, field: string): asserts value is GroundedResultProvenance[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    throw new TypeError(`${field} must be a dense array`);
  }
  value.forEach((item: Record<string, unknown>, index: number) => {
    for (const key of ['relativePath', 'title', 'excerpt']) assertNonEmptyString(item[key], `${field}[${index}].${key}`);
    if (typeof item.score !== 'number' || !Number.isFinite(item.score)) throw new TypeError(`${field}[${index}].score must be a finite number`);
  });
}

export function assertCostRecord(value: unknown): asserts value is CostRecord {
  assertRecord(value, 'Cost');
  for (const field of ['id', 'missionId', 'idempotencyKey']) assertNonEmptyString(value[field], `Cost ${field}`);
  for (const field of ['assignmentId', 'provider', 'model', 'tool']) if (field in value) assertNonEmptyString(value[field], `Cost ${field}`);
  assertEnum(value.category, CostCategory, 'Cost category');
  assertNonNegativeInteger(value.estimatedMicroUsd, 'Cost estimatedMicroUsd');
  assertNonNegativeInteger(value.actualMicroUsd, 'Cost actualMicroUsd');
  assertTimestamp(value.incurredAt, 'Cost incurredAt');
  assertProvenanceList(value.provenance, 'Cost provenance');
  assertOptionalIntegrityHash(value, 'Cost integrityHash');
  assertJsonOnly(value, 'Cost');
}

function assertRecord(
  value: unknown,
  field: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
}

function assertJsonOnly(value: unknown, field: string): void {
  if (!isJsonValue(value)) throw new TypeError(`${field} must contain only JSON values`);
}

function assertDigest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new TypeError(`${field} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new TypeError(`${field} must be a positive integer`);
  }
}

function assertRequiredConfidence(value: unknown, field: string): asserts value is number {
  const wrapper: Record<string, unknown> = { value };
  assertOptionalConfidence(wrapper, 'value', field);
}

function assertDenseEnumArray<T extends Record<string, string>>(
  value: unknown,
  enumeration: T,
  field: string,
): void {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    throw new TypeError(`${field} must be a dense array`);
  }
  value.forEach((item) => assertEnum(item, enumeration, field));
}

function assertObjectList(value: unknown, field: string): void {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length) {
    throw new TypeError(`${field} must be a dense array`);
  }
  value.forEach((item, index) => assertJsonObject(item, `${field}[${index}]`));
}

function assertDeliverableList(value: unknown, field: string): void {
  assertObjectList(value, field);
  for (const [index, item] of (value as JsonObject[]).entries()) {
    for (const key of ['id', 'description', 'artifactType']) {
      assertNonEmptyString(item[key], `${field}[${index}].${key}`);
    }
    if (typeof item.required !== 'boolean') throw new TypeError(`${field}[${index}].required must be boolean`);
  }
}

function assertAcceptanceTestList(value: unknown, field: string): void {
  assertObjectList(value, field);
  for (const [index, item] of (value as JsonObject[]).entries()) {
    assertNonEmptyString(item.id, `${field}[${index}].id`);
    assertNonEmptyString(item.description, `${field}[${index}].description`);
    if (item.verification !== 'automatic' && item.verification !== 'manual') {
      throw new TypeError(`${field}[${index}].verification is invalid`);
    }
    assertDenseStringArray(item.requiredEvidence, `${field}[${index}].requiredEvidence`);
  }
}

function assertArtifactRequirement(value: unknown, field: string): void {
  assertJsonObject(value, field);
  assertNonEmptyString(value.type, `${field}.type`);
  assertNonEmptyString(value.description, `${field}.description`);
  if ('schema' in value) assertJsonObject(value.schema, `${field}.schema`);
  assertDenseStringArray(value.verification, `${field}.verification`);
  assertDenseStringArray(value.requiredEvidence, `${field}.requiredEvidence`);
}

function assertMissionTaskDefinitionList(value: unknown, field: string): void {
  assertObjectList(value, field);
  for (const [index, item] of (value as JsonObject[]).entries()) {
    for (const key of ['id', 'title', 'selectedAgentId']) {
      assertNonEmptyString(item[key], `${field}[${index}].${key}`);
    }
    assertEnum(item.kind, MissionTaskKind, `${field}[${index}].kind`);
    assertNonNegativeInteger(item.sequence, `${field}[${index}].sequence`);
    assertEnum(item.lane, AgentLane, `${field}[${index}].lane`);
    assertNonEmptyString(item.model, `${field}[${index}].model`);
    assertPositiveInteger(item.maxTokens, `${field}[${index}].maxTokens`);
    for (const key of ['capabilityIds', 'requiredActions', 'requiredTools', 'dependsOn', 'evidenceEventIds']) {
      assertDenseStringArray(item[key], `${field}[${index}].${key}`);
    }
    assertPermissions(item.writableScope, `${field}[${index}].writableScope`);
    assertArtifactRequirement(item.expectedArtifact, `${field}[${index}].expectedArtifact`);
    if ('externalAction' in item) assertExternalAction(item.externalAction, `${field}[${index}].externalAction`);
    assertJsonObject(item.input, `${field}[${index}].input`);
    assertNonNegativeInteger(item.estimatedCostMicroUsd, `${field}[${index}].estimatedCostMicroUsd`);
    assertEnum(item.route, RouteType, `${field}[${index}].route`);
    assertEnum(item.risk, RiskLevel, `${field}[${index}].risk`);
  }
}

function assertAgentSelectionList(value: unknown, field: string): void {
  assertObjectList(value, field);
  for (const [index, item] of (value as JsonObject[]).entries()) {
    assertNonEmptyString(item.taskId, `${field}[${index}].taskId`);
    assertNonEmptyString(item.agentId, `${field}[${index}].agentId`);
    assertEnum(item.lane, AgentLane, `${field}[${index}].lane`);
    assertDenseStringArray(item.capabilityIds, `${field}[${index}].capabilityIds`);
  }
}

function assertPermissions(value: unknown, field: string): void {
  assertJsonObject(value, field);
  for (const key of ['allowedTools', 'allowedSystems', 'allowedChannels', 'allowedRecipients', 'allowedCredentialRefs', 'allowedDataScopes']) {
    assertDenseStringArray(value[key], `${field}.${key}`);
  }
  assertDenseEnumArray(value.allowedMutationClasses, MutationClass, `${field}.allowedMutationClasses`);
  assertObjectList(value.allowedRepositories, `${field}.allowedRepositories`);
  for (const [index, grant] of (value.allowedRepositories as JsonObject[]).entries()) {
    assertNonEmptyString(grant.repository, `${field}.allowedRepositories[${index}].repository`);
    assertDenseStringArray(grant.writablePaths, `${field}.allowedRepositories[${index}].writablePaths`);
    assertDenseEnumArray(grant.mutationClasses, MutationClass, `${field}.allowedRepositories[${index}].mutationClasses`);
  }
}

function assertModelPolicy(value: unknown, field: string): void {
  assertJsonObject(value, field);
  assertDenseStringArray(value.allowedModels, `${field}.allowedModels`);
  if ('preferredModel' in value) assertNonEmptyString(value.preferredModel, `${field}.preferredModel`);
  if (typeof value.preferLocal !== 'boolean') throw new TypeError(`${field}.preferLocal must be boolean`);
  assertPositiveInteger(value.maxTokensPerAssignment, `${field}.maxTokensPerAssignment`);
}

function assertExternalAction(value: unknown, field: string): void {
  assertJsonObject(value, field);
  for (const key of ['connectorId', 'action', 'destination', 'idempotencyKey']) {
    assertNonEmptyString(value[key], `${field}.${key}`);
  }
  for (const key of ['system', 'channel', 'recipient', 'repository', 'repositoryPath', 'credentialRef', 'dataScope', 'tool']) {
    if (key in value) assertNonEmptyString(value[key], `${field}.${key}`);
  }
  assertEnum(value.mutationClass, MutationClass, `${field}.mutationClass`);
}

function assertIdentityReviewEntity(value: unknown, field: string): void {
  assertRecord(value, field);
  assertNonEmptyString(value.id, `${field}.id`);
  if ('type' in value) assertEnum(value.type, EntityType, `${field}.type`);
  assertNonEmptyString(value.label, `${field}.label`);
  if (typeof value.available !== 'boolean') throw new TypeError(`${field}.available must be boolean`);
  if (typeof value.compatible !== 'boolean') throw new TypeError(`${field}.compatible must be boolean`);
}

function assertEvidenceList(value: unknown, field: string): void {
  assertObjectList(value, field);
  for (const [index, item] of (value as JsonObject[]).entries()) {
    assertNonEmptyString(item.eventId, `${field}[${index}].eventId`);
    if ('integrityHash' in item) assertDigest(item.integrityHash, `${field}[${index}].integrityHash`);
    if ('selector' in item) assertNonEmptyString(item.selector, `${field}[${index}].selector`);
  }
}

function assertStatementList(value: unknown, field: string): void {
  assertObjectList(value, field);
  for (const [index, item] of (value as JsonObject[]).entries()) {
    assertNonEmptyString(item.text, `${field}[${index}].text`);
    assertEvidenceList(item.evidence, `${field}[${index}].evidence`);
    assertRequiredConfidence(item.confidence, `${field}[${index}].confidence`);
  }
}

function assertDeadlineList(value: unknown, field: string): void {
  assertObjectList(value, field);
  for (const [index, item] of (value as JsonObject[]).entries()) {
    assertNonEmptyString(item.description, `${field}[${index}].description`);
    assertTimestamp(item.at, `${field}[${index}].at`);
    assertRequiredConfidence(item.confidence, `${field}[${index}].confidence`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown, seen = new WeakSet<object>()): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    return false;
  }
  seen.add(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    const keys = Object.keys(value);
    valid =
      keys.length === value.length &&
      keys.every((key, index) => key === String(index)) &&
      Object.getOwnPropertySymbols(value).length === 0 &&
      value.every(
        (item, index) =>
          Object.hasOwn(value, index) && isJsonValue(item, seen),
      );
  } else if (
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    valid = false;
  } else {
    valid =
      Object.getOwnPropertySymbols(value).length === 0 &&
      Object.values(value).every((item) => isJsonValue(item, seen));
  }
  seen.delete(value);
  return valid;
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertDenseStringArray(
  value: unknown,
  field: string,
): asserts value is string[] {
  const keys = Array.isArray(value) ? Object.keys(value) : [];
  if (
    !Array.isArray(value) ||
    keys.length !== value.length ||
    !keys.every((key, index) => key === String(index)) ||
    !value.every(
      (item, index) =>
        Object.hasOwn(value, index) &&
        typeof item === 'string' &&
        item.length > 0,
    )
  ) {
    throw new TypeError(`${field} must be a dense string array`);
  }
}

function assertJsonObject(value: unknown, field: string): asserts value is JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new TypeError(`${field} must be a JSON object`);
  }
}

function assertEnum<T extends Record<string, string>>(
  value: unknown,
  enumeration: T,
  field: string,
): asserts value is T[keyof T] {
  if (typeof value !== 'string' || !Object.values(enumeration).includes(value)) {
    throw new TypeError(`${field} is invalid`);
  }
}

function assertOptionalEnum<T extends Record<string, string>>(
  record: Record<string, unknown>,
  key: string,
  enumeration: T,
  field: string,
): void {
  if (key in record) {
    assertEnum(record[key], enumeration, field);
  }
}

function assertOptionalConfidence(
  record: Record<string, unknown>,
  key: string,
  field: string,
): void {
  if (!(key in record)) return;
  const value = record[key];
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new TypeError(`${field} must be a finite number from 0 to 1`);
  }
}

function assertFreshness(value: unknown, field: string): asserts value is Freshness {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  assertTimestamp(value.observedAt, `${field}.observedAt`);
  for (const key of ['validAt', 'staleAt', 'expiresAt']) {
    if (key in value) assertTimestamp(value[key], `${field}.${key}`);
  }
  assertOptionalEnum(value, 'status', FreshnessStatus, `${field}.status`);
}

function assertProvenanceList(
  value: unknown,
  field: string,
): asserts value is Provenance[] {
  const keys = Array.isArray(value) ? Object.keys(value) : [];
  if (
    !Array.isArray(value) ||
    keys.length !== value.length ||
    !keys.every((key, index) => key === String(index))
  ) {
    throw new TypeError(`${field} must be a dense array`);
  }
  value.forEach((item, index) => assertProvenance(item, `${field}[${index}]`));
}

function assertProvenance(value: unknown, field: string): asserts value is Provenance {
  if (!isRecord(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  assertNonEmptyString(value.source, `${field}.source`);
  assertEnum(value.sourceType, SourceType, `${field}.sourceType`);
  assertTimestamp(value.observedAt, `${field}.observedAt`);
  for (const key of ['sourceEventId', 'actorId']) {
    if (key in value) assertNonEmptyString(value[key], `${field}.${key}`);
  }
  if ('receivedAt' in value) {
    assertTimestamp(value.receivedAt, `${field}.receivedAt`);
  }
  assertOptionalConfidence(value, 'confidence', `${field}.confidence`);
  assertOptionalIntegrityHash(value, `${field}.integrityHash`);
}

function assertOptionalIntegrityHash(
  record: Record<string, unknown>,
  field: string,
): void {
  const key = 'integrityHash';
  if (key in record && !/^[0-9a-f]{64}$/.test(String(record[key]))) {
    throw new TypeError(`${field} must be a lowercase SHA-256 digest`);
  }
}

function assertTimestamp(value: unknown, field: string): asserts value is IsoTimestamp {
  if (typeof value !== 'string' || !isCanonicalRfc3339(value)) {
    throw new TypeError(`${field} must be a canonical RFC3339 timestamp`);
  }
}

function isCanonicalRfc3339(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
    value,
  );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] ? Number(match[10]) : 0;
  const offsetMinute = match[11] ? Number(match[11]) : 0;
  if (
    year === 0 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > new Date(Date.UTC(year, month, 0)).getUTCDate() ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 14 ||
    offsetMinute > 59 ||
    (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}
