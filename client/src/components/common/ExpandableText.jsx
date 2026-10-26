import React, { useState } from "react";

/**
 * Renders untrusted text strictly as plain text (zero dangerouslySetInnerHTML)
 * with an optional truncation and expand/collapse control.
 */
export function ExpandableText({ text, maxChars = 120, className = "" }) {
  const [expanded, setExpanded] = useState(false);

  if (text === null || text === undefined) {
    return <span className="text-slate-400 italic">None</span>;
  }

  const str = typeof text === "string" ? text : JSON.stringify(text);

  if (str.length <= maxChars) {
    return <span className={className}>{str}</span>;
  }

  return (
    <span className={className}>
      {expanded ? str : `${str.slice(0, maxChars)}... `}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="ml-1 text-xs text-indigo-600 hover:text-indigo-800 font-semibold underline focus:outline-hidden"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </span>
  );
}

export default ExpandableText;
