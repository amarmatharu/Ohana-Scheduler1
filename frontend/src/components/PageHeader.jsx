import React from "react";

export default function PageHeader({ title, subtitle, action }) {
  return (
    <div className="px-10 pt-10 pb-6 border-b border-soft mb-8 bg-surface">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-medium tracking-tight" style={{fontFamily:'Outfit'}}>{title}</h1>
          {subtitle && <p className="text-muted-ohana mt-2 text-[15px]">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
    </div>
  );
}
