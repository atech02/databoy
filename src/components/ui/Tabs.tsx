"use client";

import React from "react";

export interface TabOption {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TabsProps {
  tabs: TabOption[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  className = ""
}) => {
  return (
    <div className={`border-b border-border/60 ${className}`}>
      <nav className="flex gap-2 pb-3 overflow-x-auto scrollbar-none md:space-x-6 md:gap-0 md:pb-0 -mb-px" aria-label="Tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex items-center gap-2 font-medium transition-all duration-200 whitespace-nowrap cursor-pointer min-h-[44px] md:min-h-0 py-2 px-4 rounded-full text-xs md:rounded-none md:py-4 md:px-1 md:border-b-2 md:text-sm md:font-medium ${
                isActive
                  ? "bg-primary text-primary-foreground md:bg-transparent md:border-primary md:text-primary md:font-semibold"
                  : "bg-secondary/40 text-muted-foreground hover:bg-secondary/70 hover:text-foreground md:bg-transparent md:border-transparent md:text-muted-foreground md:hover:text-foreground md:hover:border-border"
              }`}
            >
              {tab.icon && <span className="opacity-80">{tab.icon}</span>}
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
