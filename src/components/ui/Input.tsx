import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  error?: string;
  helperText?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  className = "",
  id,
  type = "text",
  ...props
}) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
      )}
      <input
        type={type}
        id={inputId}
        className={`w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-background border rounded-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 hover:border-muted-foreground/30 placeholder:text-muted-foreground/50 ${
          error ? "border-destructive focus:ring-destructive/30" : "border-border/50"
        } ${className}`}
        {...props}
      />
      {error && <span className="text-xs font-medium text-destructive">{error}</span>}
      {!error && helperText && <span className="text-xs text-muted-foreground">{helperText}</span>}
    </div>
  );
};

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: React.ReactNode;
  error?: string;
  helperText?: string;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  helperText,
  className = "",
  id,
  ...props
}) => {
  const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={textareaId} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
      )}
      <textarea
        id={textareaId}
        className={`w-full px-3.5 py-2.5 text-sm bg-background border rounded-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 hover:border-muted-foreground/30 placeholder:text-muted-foreground/50 min-h-[100px] resize-y ${
          error ? "border-destructive focus:ring-destructive/30" : "border-border/50"
        } ${className}`}
        {...props}
      />
      {error && <span className="text-xs font-medium text-destructive">{error}</span>}
      {!error && helperText && <span className="text-xs text-muted-foreground">{helperText}</span>}
    </div>
  );
};

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: React.ReactNode;
  error?: string;
  helperText?: string;
  options: { value: string; label: string }[];
}

export const Select: React.FC<SelectProps> = ({
  label,
  error,
  helperText,
  options,
  className = "",
  id,
  ...props
}) => {
  const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className="w-full flex flex-col gap-1.5">
      {label && (
        <label htmlFor={selectId} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={selectId}
          className={`w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-background border rounded-lg appearance-none transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 hover:border-muted-foreground/30 cursor-pointer ${
            error ? "border-destructive focus:ring-destructive/30" : "border-border/50"
          } ${className}`}
          {...props}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-muted-foreground">
          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
          </svg>
        </div>
      </div>
      {error && <span className="text-xs font-medium text-destructive">{error}</span>}
      {!error && helperText && <span className="text-xs text-muted-foreground">{helperText}</span>}
    </div>
  );
};
