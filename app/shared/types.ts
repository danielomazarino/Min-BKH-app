/**
 * Shared types for the app — re-exported from the pipeline models so the app
 * and the pipeline always agree on the data shapes.
 */
export * from "../../pipeline/src/types";

/**
 * The API measurement log's shapes, re-exported from the recorder so the
 * diagnostics panel reads the exact contract the pipeline writes.
 *
 * These are DIAGNOSTIC types, not app data: nothing in the supporter-facing
 * UI depends on them, and `ApiMetrics` is deliberately absent from `AppData`
 * so the log can be fetched lazily instead of on first paint.
 */
export type {
  ApiCallRecord,
  ApiMetrics,
  MeteredBudget,
  RunRecord,
  ServiceAggregate,
  SourceArticles,
} from "../../pipeline/src/apiMetrics";
