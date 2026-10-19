import { useMemo, useRef, useState } from "react";
import { chipLabel, formatToken, getSuggestions, parseQuery } from "./searchQuery.js";

// A single text box where each filter becomes a removable chip (perk:discord, is:strand, ...).
export default function SearchBar({ tokens, onChange, context }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);

  const suggestions = useMemo(() => getSuggestions(text, context), [text, context]);
  const showSuggestions = open && suggestions.length > 0;

  function addTokens(newTokens) {
    const existing = new Set(tokens.map(formatToken));
    const fresh = newTokens.filter((t) => !existing.has(formatToken(t)));
    if (fresh.length > 0) onChange([...tokens, ...fresh]);
    setText("");
    setActive(0);
  }

  function choose(suggestion) {
    if (suggestion.complete) {
      setText(suggestion.complete);
      setActive(0);
      inputRef.current?.focus();
      return;
    }
    addTokens([suggestion.token]);
  }

  // Plain text with no key stays one name search ("refusal of the call"), otherwise
  // the text may hold several key:value tokens typed in one go.
  function tokensFromText(value) {
    const trimmed = value.trim();
    if (!trimmed) return [];
    return trimmed.includes(":") ? parseQuery(trimmed) : [{ key: "name", value: trimmed.toLowerCase() }];
  }

  function handleInput(e) {
    const value = e.target.value;
    // A finished key:value followed by a space becomes a chip straight away.
    const finished = /^(\w+):("[^"]+"|[^\s"]+) $/.exec(value);
    if (finished) {
      const parsed = parseQuery(value);
      if (parsed.length === 1 && parsed[0].key !== "name") {
        addTokens(parsed);
        return;
      }
    }
    setText(value);
    setActive(0);
    setOpen(true);
  }

  function handleKeyDown(e) {
    if (e.key === "ArrowDown" && showSuggestions) {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && showSuggestions) {
      e.preventDefault();
      setActive((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const multiToken = text.includes(":") && parseQuery(text).length > 1;
      if (showSuggestions && !multiToken) choose(suggestions[active]);
      else addTokens(tokensFromText(text));
    } else if (e.key === "Backspace" && text === "" && tokens.length > 0) {
      onChange(tokens.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function removeToken(index) {
    onChange(tokens.filter((_, i) => i !== index));
    inputRef.current?.focus();
  }

  function clearAll() {
    onChange([]);
    setText("");
    inputRef.current?.focus();
  }

  return (
    <div className="search-bar" onClick={() => inputRef.current?.focus()}>
      <div className="search-chips">
        {tokens.map((t, i) => (
          <span className="search-chip" key={formatToken(t)}>
            {chipLabel(t)}
            <button
              type="button"
              aria-label={`Remove ${chipLabel(t)}`}
              onClick={(e) => {
                e.stopPropagation();
                removeToken(i);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={text}
          placeholder={tokens.length === 0 ? "Search: name, perk:discord, is:strand, type:glaive, season:>=24..." : ""}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {(tokens.length > 0 || text) && (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={clearAll}>
          ×
        </button>
      )}
      {showSuggestions && (
        <ul className="search-suggestions" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={`${s.label}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span className="suggestion-icon">{s.icon && <img src={s.icon} alt="" />}</span>
              <span className="suggestion-label">{s.label}</span>
              {s.hint && <span className="suggestion-hint">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
