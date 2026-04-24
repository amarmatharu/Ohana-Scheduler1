import React, { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Input } from "./ui/input";
import { MapPin } from "lucide-react";

/**
 * Address typeahead with Google Places suggestions (proxied via /api/places/autocomplete).
 * Props: { value, onChange(addressString), required, testId, placeholder }
 */
export default function AddressAutocomplete({ value, onChange, required, testId = "address-input", placeholder = "Start typing an address…" }) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);
  const skipNext = useRef(false);

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (skipNext.current) { skipNext.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value || value.length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/places/autocomplete", { params: { input: value } });
        setSuggestions(data.suggestions || []);
        setOpen((data.suggestions || []).length > 0);
        setHighlight(-1);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [value]);

  const pick = (s) => {
    skipNext.current = true;
    onChange(s.description);
    setOpen(false);
    setSuggestions([]);
  };

  const onKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative" data-testid={`${testId}-wrap`}>
      <Input
        data-testid={testId}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
      />
      {loading && (
        <span data-testid={`${testId}-loading`} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-ohana">…</span>
      )}
      {open && suggestions.length > 0 && (
        <div data-testid={`${testId}-suggestions`} className="absolute z-50 mt-1 w-full bg-white border border-soft rounded-md shadow-lg max-h-72 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              type="button"
              key={s.place_id}
              data-testid={`${testId}-suggestion-${i}`}
              onClick={() => pick(s)}
              className={`w-full text-left px-3 py-2.5 text-sm flex items-start gap-2 transition-colors ${highlight === i ? "bg-[#E5EBE8]" : "hover:bg-muted-soft"}`}
            >
              <MapPin size={14} className="mt-0.5 text-[#274f38] shrink-0" />
              <span>{s.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
