import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost" | "link";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = "primary",
  size = "md",
  isLoading = false,
  fullWidth = false,
  className = "",
  disabled,
  ...props
}) => {
  const baseStyles = "inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-300 ease-out focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 cursor-pointer";
  
  const variants = {
    primary: "bg-gradient-to-r from-indigo-600 via-primary to-purple-600 text-primary-foreground hover:brightness-110 shadow-[0_4px_16px_rgba(99,102,241,0.15)] hover:shadow-[0_4px_26px_rgba(99,102,241,0.3)] border border-primary/20",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/90 border border-border/40",
    outline: "border border-border/50 bg-transparent hover:bg-secondary/50 text-foreground hover:border-muted-foreground/30",
    danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-md shadow-destructive/15",
    ghost: "bg-transparent text-foreground hover:bg-secondary/40",
    link: "bg-transparent text-primary hover:underline p-0 active:scale-100",
  };

  const sizes = {
    sm: "px-3 py-2 md:py-1.5 text-xs min-h-[44px] md:min-h-0",
    md: "px-4 py-3 md:py-2.5 text-sm min-h-[44px] md:min-h-0",
    lg: "px-6 py-3.5 text-base min-h-[48px]",
  };

  const widthStyle = fullWidth ? "w-full" : "";

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${widthStyle} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading...
        </>
      ) : (
        children
      )}
    </button>
  );
};
