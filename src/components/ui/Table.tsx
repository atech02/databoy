import React from "react";

export const TableContainer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <div className={`w-full overflow-x-auto rounded-xl border border-border bg-card/40 ${className}`} {...props}>
      {children}
    </div>
  );
};

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <table className={`w-full border-collapse text-left text-sm ${className}`} {...props}>
      {children}
    </table>
  );
};

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <thead className={`bg-muted/30 border-b border-border/60 ${className}`} {...props}>
      {children}
    </thead>
  );
};

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <tbody className={`divide-y divide-border/30 ${className}`} {...props}>
      {children}
    </tbody>
  );
};

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <tr className={`transition-colors hover:bg-muted/10 ${className}`} {...props}>
      {children}
    </tr>
  );
};

export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <th className={`px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground ${className}`} {...props}>
      {children}
    </th>
  );
};

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <td className={`px-6 py-4 whitespace-nowrap align-middle text-foreground ${className}`} {...props}>
      {children}
    </td>
  );
};
