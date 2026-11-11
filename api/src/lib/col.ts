import { sql, getTableName, type Column } from 'drizzle-orm';
import type { Table } from 'drizzle-orm';

/** مرجع عمود مؤهَّل باسم الجدول لاستخدامه داخل الاستعلامات الفرعية */
export const qcol = (col: Column) => sql.raw(`"${getTableName(col.table as unknown as Table)}"."${col.name}"`);
