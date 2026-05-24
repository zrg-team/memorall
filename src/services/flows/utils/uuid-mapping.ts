import { consoleFlowLogger, type IFlowLogger } from "../interfaces/logger";
import { nanoid } from "nanoid";

// UUID validation regex (supports both standard UUIDs and nanoid format)
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NANOID_REGEX = /^[A-Za-z0-9_-]{21}$/;

export interface UuidMappingResult {
	/** The correct UUID to use (either existing or newly generated) */
	correctUuid: string;
	/** Whether this UUID points to an existing entity/edge */
	isExisting: boolean;
	/** The final name to use (from existing node if found) */
	finalName?: string;
}

/**
 * Minimal node interface for UUID mapping
 * Only requires id and name fields
 */
export interface MinimalNode {
	id: string;
	name: string;
}

/**
 * Minimal edge interface for UUID mapping
 * Only requires id, sourceId, destinationId, and edgeType fields
 */
export interface MinimalEdge {
	id: string;
	sourceId: string;
	destinationId: string;
	edgeType: string;
}

/**
 * Maps an LLM-provided UUID to a correct UUID by:
 * 1. If LLM UUID is valid and exists, use it
 * 2. If invalid/non-existent, try to find matching node by name
 * 3. If no match found, generate new UUID
 *
 * Also maintains a mapping cache for consistency across the same resolution session
 */
export class UuidMapper {
	private llmToCorrectMap = new Map<string, UuidMappingResult>();

	constructor(private logger: IFlowLogger = consoleFlowLogger) {}

	/**
	 * Map entity UUID from LLM to correct node UUID
	 */
	mapEntityUuid(
		entityName: string,
		llmProvidedUuid: string | undefined,
		finalName: string,
		existingNodes: MinimalNode[],
	): UuidMappingResult {
		// If we already mapped this LLM UUID, return cached result
		if (llmProvidedUuid && this.llmToCorrectMap.has(llmProvidedUuid)) {
			return this.llmToCorrectMap.get(llmProvidedUuid)!;
		}

		// Create lookup maps for existing nodes
		const nodeIdToNode = new Map(
			existingNodes.filter((n) => n.id).map((n) => [n.id, n]),
		);
		const nodeNameToNode = new Map(
			existingNodes
				.filter((n) => n.name)
				.map((n) => [n.name.toLowerCase().trim(), n]),
		);

		let result: UuidMappingResult;

		// Strategy 1: If LLM provided a valid UUID and it exists, use it
		if (
			llmProvidedUuid &&
			UUID_REGEX.test(llmProvidedUuid) &&
			nodeIdToNode.has(llmProvidedUuid)
		) {
			const existingNode = nodeIdToNode.get(llmProvidedUuid)!;
			result = {
				correctUuid: llmProvidedUuid,
				isExisting: true,
				finalName: existingNode.name,
			};
			this.logger.info(`[UUID_MAPPER] Valid UUID from LLM: ${llmProvidedUuid}`);
		}
		// Strategy 2: Try to find by final_name (exact match, case-insensitive)
		else {
			const nodeByFinalName = nodeNameToNode.get(
				finalName.toLowerCase().trim(),
			);
			if (nodeByFinalName?.id) {
				result = {
					correctUuid: nodeByFinalName.id,
					isExisting: true,
					finalName: nodeByFinalName.name,
				};
				if (llmProvidedUuid) {
					this.logger.info(
						`[UUID_MAPPER] Corrected entity UUID for "${entityName}": ${llmProvidedUuid} -> ${nodeByFinalName.id} (matched by final_name)`,
					);
					// Cache the mapping
					this.llmToCorrectMap.set(llmProvidedUuid, result);
				}
			}
			// Strategy 3: Try to find by entity name (exact match, case-insensitive)
			else {
				const nodeByEntityName = nodeNameToNode.get(
					entityName.toLowerCase().trim(),
				);
				if (nodeByEntityName?.id) {
					result = {
						correctUuid: nodeByEntityName.id,
						isExisting: true,
						finalName: nodeByEntityName.name,
					};
					if (llmProvidedUuid) {
						this.logger.info(
							`[UUID_MAPPER] Corrected entity UUID for "${entityName}": ${llmProvidedUuid} -> ${nodeByEntityName.id} (matched by entity name)`,
						);
						// Cache the mapping
						this.llmToCorrectMap.set(llmProvidedUuid, result);
					}
				}
				// Strategy 4: No match found - generate new ID using nanoid
				else {
					const newId = nanoid();
					result = {
						correctUuid: newId,
						isExisting: false,
						finalName,
					};

					if (llmProvidedUuid) {
						if (
							!UUID_REGEX.test(llmProvidedUuid) &&
							!NANOID_REGEX.test(llmProvidedUuid)
						) {
							this.logger.error(
								`[UUID_MAPPER] Invalid ID format from LLM for entity "${entityName}": ${llmProvidedUuid}. Generated new ID: ${newId}`,
							);
						} else {
							this.logger.error(
								`[UUID_MAPPER] Non-existent ID from LLM for entity "${entityName}": ${llmProvidedUuid}. Generated new ID: ${newId}`,
							);
						}
						// Cache the mapping
						this.llmToCorrectMap.set(llmProvidedUuid, result);
					} else {
						this.logger.info(
							`[UUID_MAPPER] No ID provided for new entity "${entityName}". Generated: ${newId}`,
						);
					}
				}
			}
		}

		return result;
	}

	/**
	 * Map fact/edge UUID from LLM to correct edge UUID
	 */
	mapFactUuid(
		sourceEntityId: string,
		destEntityId: string,
		relationType: string,
		llmProvidedUuid: string | undefined,
		existingEdges: MinimalEdge[],
		resolvedEntities: Array<{ uuid: string; existingId?: string }>,
	): UuidMappingResult {
		// If we already mapped this LLM UUID, return cached result
		if (llmProvidedUuid && this.llmToCorrectMap.has(llmProvidedUuid)) {
			return this.llmToCorrectMap.get(llmProvidedUuid)!;
		}

		// Create lookup maps for existing edges
		const edgeIdToEdge = new Map(
			existingEdges.filter((e) => e.id).map((e) => [e.id, e]),
		);

		// Create a map for finding edges by their characteristics
		// Key: "sourceId|destId|edgeType"
		const edgeKeyToEdge = new Map<string, MinimalEdge>();
		for (const edge of existingEdges) {
			if (edge.sourceId && edge.destinationId && edge.edgeType) {
				const key = `${edge.sourceId}|${edge.destinationId}|${edge.edgeType}`;
				edgeKeyToEdge.set(key, edge);
				// Also add reverse for bidirectional matching
				const reverseKey = `${edge.destinationId}|${edge.sourceId}|${edge.edgeType}`;
				if (!edgeKeyToEdge.has(reverseKey)) {
					edgeKeyToEdge.set(reverseKey, edge);
				}
			}
		}

		let result: UuidMappingResult;

		// Strategy 1: If LLM provided a valid UUID and it exists, use it
		if (
			llmProvidedUuid &&
			UUID_REGEX.test(llmProvidedUuid) &&
			edgeIdToEdge.has(llmProvidedUuid)
		) {
			result = {
				correctUuid: llmProvidedUuid,
				isExisting: true,
			};
			this.logger.info(
				`[UUID_MAPPER] Valid edge UUID from LLM: ${llmProvidedUuid}`,
			);
		}
		// Strategy 2: Try to find by matching source, destination, and relation type
		else {
			// Resolve entity UUIDs to node IDs
			const sourceEntity = resolvedEntities.find(
				(e) => e.uuid === sourceEntityId,
			);
			const destEntity = resolvedEntities.find((e) => e.uuid === destEntityId);

			if (sourceEntity?.existingId && destEntity?.existingId) {
				// Both entities exist - try to find edge by source/dest/type
				const edgeKey = `${sourceEntity.existingId}|${destEntity.existingId}|${relationType}`;
				const matchingEdge = edgeKeyToEdge.get(edgeKey);

				if (matchingEdge?.id) {
					result = {
						correctUuid: matchingEdge.id,
						isExisting: true,
					};
					if (llmProvidedUuid) {
						this.logger.info(
							`[UUID_MAPPER] Corrected edge UUID: ${llmProvidedUuid} -> ${matchingEdge.id} (matched by source/dest/type)`,
						);
						// Cache the mapping
						this.llmToCorrectMap.set(llmProvidedUuid, result);
					}
				} else {
					// No existing edge found - generate new ID using nanoid
					const newId = nanoid();
					result = {
						correctUuid: newId,
						isExisting: false,
					};

					if (llmProvidedUuid) {
						if (
							!UUID_REGEX.test(llmProvidedUuid) &&
							!NANOID_REGEX.test(llmProvidedUuid)
						) {
							this.logger.error(
								`[UUID_MAPPER] Invalid ID format from LLM for fact "${relationType}": ${llmProvidedUuid}. Generated new ID: ${newId}`,
							);
						} else {
							this.logger.error(
								`[UUID_MAPPER] Non-existent ID from LLM for fact "${relationType}": ${llmProvidedUuid}. Generated new ID: ${newId}`,
							);
						}
						// Cache the mapping
						this.llmToCorrectMap.set(llmProvidedUuid, result);
					} else {
						this.logger.info(
							`[UUID_MAPPER] No ID provided for new fact "${relationType}". Generated: ${newId}`,
						);
					}
				}
			} else {
				// One or both entities are new - generate new edge ID using nanoid
				const newId = nanoid();
				result = {
					correctUuid: newId,
					isExisting: false,
				};

				if (llmProvidedUuid) {
					this.logger.info(
						`[UUID_MAPPER] Entities are new, generated new edge ID for fact "${relationType}": ${newId}`,
					);
					// Cache the mapping
					this.llmToCorrectMap.set(llmProvidedUuid, result);
				}
			}
		}

		return result;
	}

	/**
	 * Get the mapping of LLM UUIDs to correct UUIDs for debugging/logging
	 */
	getMappings(): Map<string, UuidMappingResult> {
		return new Map(this.llmToCorrectMap);
	}

	/**
	 * Clear all cached mappings (useful when starting a new resolution session)
	 */
	clear(): void {
		this.llmToCorrectMap.clear();
	}
}
