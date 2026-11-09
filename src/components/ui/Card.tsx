import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glass?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  glass = false,
  ...props
}) => {
  const baseStyle = "rounded-xl border border-border/50 bg-card text-card-foreground shadow-sm hover:border-primary/20 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 ease-out";
  const glassStyle = glass 
    ? "backdrop-blur-md bg-card/65 dark:bg-card/45 border-white/10 dark:border-white/5 shadow-lg shadow-black/10" 
    : "";

  return (
    <div className={`${baseStyle} ${glassStyle} ${className}`} {...props}>
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <div className={`flex flex-col gap-1.5 p-4 md:p-6 border-b border-border/40 ${className}`} {...props}>
      {children}
    </div>
  );
};

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <h3 className={`text-lg font-bold tracking-tight text-foreground ${className}`} {...props}>
      {children}
    </h3>
  );
};

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <p className={`text-sm text-muted-foreground ${className}`} {...props}>
      {children}
    </p>
  );
};

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <div className={`p-4 md:p-6 ${className}`} {...props}>
      {children}
    </div>
  );
};

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <div className={`flex items-center p-4 md:p-6 border-t border-border/40 bg-muted/20 ${className}`} {...props}>
      {children}
    </div>
  );
};
