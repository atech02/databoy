import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "primary" | "secondary" | "success" | "warning" | "danger" | "info";
  outline?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = "secondary",
  outline = false,
  className = "",
  ...props
}) => {
  const baseStyle = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors duration-200 select-none";
  
  const variants = {
    primary: "bg-primary/10 text-primary border border-primary/20",
    secondary: "bg-secondary text-secondary-foreground border border-border",
    success: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 dark:text-emerald-400 dark:bg-emerald-500/5",
    warning: "bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:text-amber-400 dark:bg-amber-500/5",
    danger: "bg-destructive/10 text-destructive border border-destructive/20",
    info: "bg-blue-500/10 text-blue-600 border border-blue-500/20 dark:text-blue-400 dark:bg-blue-500/5",
  };

  const outlineVariants = {
    primary: "border border-primary text-primary bg-transparent",
    secondary: "border border-muted-foreground text-muted-foreground bg-transparent",
    success: "border border-emerald-500 text-emerald-500 bg-transparent dark:text-emerald-400 dark:border-emerald-400",
    warning: "border border-amber-500 text-amber-600 bg-transparent dark:text-amber-400 dark:border-amber-400",
    danger: "border border-destructive text-destructive bg-transparent",
    info: "border border-blue-500 text-blue-600 bg-transparent dark:text-blue-400 dark:border-blue-400",
  };

  const styleClass = outline ? outlineVariants[variant] : variants[variant];

  return (
    <span className={`${baseStyle} ${styleClass} ${className}`} {...props}>
      {children}
    </span>
  );
};
