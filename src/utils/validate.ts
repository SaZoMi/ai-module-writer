/**
 * Validates that an entity name is not empty/whitespace and does not contain path traversal characters.
 * Calls process.exit(1) on failure (consistent with CLI script pattern).
 */
export function validateEntityName(entityName: string, entityType: string): void {
  if (!entityName || entityName.trim() === '') {
    console.error(`ERROR: ${entityType} name must not be empty`);
    process.exit(1);
  }
  if (entityName.includes('/') || entityName.includes('\\') || entityName.includes('..')) {
    console.error(`ERROR: ${entityType} name '${entityName}' contains invalid path characters`);
    process.exit(1);
  }
}
