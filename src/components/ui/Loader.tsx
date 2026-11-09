import React from "react";

export interface LoaderProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const Loader: React.FC<LoaderProps> = ({
  size = "md",
  className = ""
}) => {
  const sizeClasses = {
    sm: "w-5 h-5 border-2",
    md: "w-8 h-8 border-3",
    lg: "w-12 h-12 border-4",
  };

  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className={`animate-spin rounded-full border-t-primary border-r-transparent border-b-transparent border-l-transparent ${sizeClasses[size]}`} />
    </div>
  );
};

export const FullPageLoader: React.FC = () => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-md">
      <div className="relative flex flex-col items-center gap-4">
        {/* Animated outer ring */}
        <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        
        {/* Logo text reflection */}
        <span className="text-sm font-bold tracking-widest uppercase text-muted-foreground animate-pulse">
          DataBoy
        </span>
      </div>
    </div>
  );
};

export interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = "",
  variant = "rectangular"
}) => {
  const variants = {
    text: "h-3.5 w-full rounded",
    circular: "rounded-full",
    rectangular: "rounded-lg",
  };

  return (
    <div className={`animate-pulse bg-muted/65 dark:bg-muted/45 ${variants[variant]} ${className}`} />
  );
};
