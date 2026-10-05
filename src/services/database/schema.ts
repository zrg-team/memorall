/**
 * Database Schema Export
 *
 * Centralized schema export for all database entities.
 * Safe to import in both main and proxy modes.
 *
 * Note: While this imports drizzle entity definitions, it does NOT import
 * PGlite or the drizzle wrapper, making it lighter than importing db.ts.
 */

// Import all entity schemas
import * as conversationSchema from "./entities/conversations";
import * as messageSchema from "./entities/messages";
import * as sourcesSchema from "./entities/sources";
import * as nodesSchema from "./entities/nodes";
import * as edgesSchema from "./entities/edges";
import * as sourceNodesSchema from "./entities/source-nodes";
import * as sourceEdgesSchema from "./entities/source-edges";
import * as encryptionSchema from "./entities/encryptions";
import * as configurationSchema from "./entities/configurations";
import * as topicSchema from "./entities/topics";
import * as topicFilesSchema from "./entities/topic-files";
import * as activitySessionsSchema from "./entities/activity-sessions";
import * as activitiesSchema from "./entities/activities";
import * as flowsSchema from "./entities/flows";
import * as flowStatesSchema from "./entities/flow-states";
import * as flowServicesSchema from "./entities/flow-services";
import * as flowStepsSchema from "./entities/flow-steps";
import * as flowConnectionsSchema from "./entities/flow-connections";
import * as flowConfigsSchema from "./entities/flow-configs";
import * as cronJobsSchema from "./entities/cron-jobs";
import * as modelUsageSchema from "./entities/model-usage";

// Export consolidated schema object
export const schema = {
	// Conversation entities
	conversations: conversationSchema.conversation,
	messages: messageSchema.message,
	// Knowledge graph entities
	sources: sourcesSchema.source,
	nodes: nodesSchema.node,
	edges: edgesSchema.edge,
	sourceNodes: sourceNodesSchema.sourceNode,
	sourceEdges: sourceEdgesSchema.sourceEdge,
	// Encryption entities
	encryption: encryptionSchema.encryption,
	// Generic configurations (JSONB)
	configurations: configurationSchema.configuration,
	// Topic entities
	topics: topicSchema.topic,
	topicFiles: topicFilesSchema.topicFiles,
	// Activity tracking entities
	activitySessions: activitySessionsSchema.activitySessions,
	activities: activitiesSchema.activities,
	// Flow builder entities
	flows: flowsSchema.flows,
	flowStates: flowStatesSchema.flowStates,
	flowServices: flowServicesSchema.flowServices,
	flowSteps: flowStepsSchema.flowSteps,
	flowConnections: flowConnectionsSchema.flowConnections,
	flowConfigs: flowConfigsSchema.flowConfigs,
	cronJobs: cronJobsSchema.cronJobs,
	// Model requests outside chat replies
	modelUsage: modelUsageSchema.modelUsage,
};
