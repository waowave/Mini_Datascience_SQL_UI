// ─────────────────────────────────────────────
//  Core Data Types
// ─────────────────────────────────────────────

export type ColumnType = 'text' | 'integer' | 'float' | 'date' | 'boolean' | 'unknown';

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  nullable?: boolean;
}

export interface TableMetadata {
  id: string;
  name: string;
  columns: ColumnMeta[];
  rowCount?: number;
  sourceType: 'csv' | 'xlsx' | 'manual' | 'virtual' | 'demo';
  /** Raw row data stored in memory (for web-only version) */
  rows: Record<string, any>[];
}

// ─────────────────────────────────────────────
//  Pipeline / Step Types
// ─────────────────────────────────────────────

export type StepType =
  | 'FROM'
  | 'FILTER'
  | 'JOIN'
  | 'FORMULA'
  | 'GROUP'
  | 'TRANSFORM'
  | 'SORT'
  | 'RENAME'
  | 'LIMIT'
  | 'SELECT';

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'LIKE'
  | 'NOT LIKE'
  | 'IS NULL'
  | 'IS NOT NULL'
  | 'IN';

export type JoinType = 'inner' | 'left' | 'right' | 'full';

export type AggFunc = 'SUM' | 'AVG' | 'COUNT' | 'COUNT DISTINCT' | 'MIN' | 'MAX';

export type SortDir = 'ASC' | 'DESC';

export interface FilterCondition {
  col: string;
  op: FilterOperator;
  val: any;
  conjunction?: 'AND' | 'OR';
}

export interface JoinParams {
  targetTable: string;      // table id
  targetTableName: string;
  type: JoinType;
  on: [string, string];     // [leftCol, rightCol]
}

export interface FormulaParams {
  newCol: string;
  expr: string;   // Excel-like: [Price] * [Qty]
}

export interface AggParams {
  groups: string[];
  aggs: { col: string; func: AggFunc; alias?: string }[];
}

export interface SortParams {
  sorts: { col: string; dir: SortDir }[];
}

export interface RenameParams {
  renames: { from: string; to: string }[];
}

export interface SelectParams {
  columns: string[];
}

export interface StepParams {
  // FROM
  tableId?: string;
  tableName?: string;
  // FILTER
  conditions?: FilterCondition[];
  // JOIN
  join?: JoinParams;
  // FORMULA
  formula?: FormulaParams;
  // GROUP
  aggregate?: AggParams;
  // SORT
  sort?: SortParams;
  // RENAME
  rename?: RenameParams;
  // LIMIT
  limit?: number;
  offset?: number;
  // SELECT
  select?: SelectParams;
  // TRANSFORM
  transforms?: { col: string; func: string; arg?: string; newCol: string }[];
}

export interface StepUIMeta {
  isCollapsed: boolean;
  comment: string;
  isActive: boolean;
  color?: string;
}

export interface Step {
  id: string;
  type: StepType;
  params: StepParams;
  uiMeta: StepUIMeta;
}

// ─────────────────────────────────────────────
//  Pipeline & Project
// ─────────────────────────────────────────────

export interface Pipeline {
  id: string;
  name: string;
  steps: Step[];
}

export interface ProjectState {
  pipelines: Pipeline[];
  activeTabId: string;
  sources: TableMetadata[];
}

// ─────────────────────────────────────────────
//  UI State
// ─────────────────────────────────────────────

export interface CompileResult {
  sql: string;
  humanSteps: string[];
  error?: string;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: Record<string, any>[];
  totalRows: number;
  executionTime?: number;
  error?: string;
}
