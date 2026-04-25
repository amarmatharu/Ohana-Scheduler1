import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../lib/api";
import PageHeader from "../components/PageHeader";
import WeeklyPreview from "../components/WeeklyPreview";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  GitMerge, MapPin, Heart, CheckCircle2, AlertTriangle, Sparkles,
  UserPlus, Clock, Award, Car, CalendarCheck, Users, X, Filter, Plus, Trash2
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";

function nextMonday() {
  const d = new Date();
  const day = d.getDay();
  const diff = (8 - day) % 7 || 7; // next Monday (always future)
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function CoverageBar({ covered, needed }) {
  const pct = needed > 0 ? Math.min(100, Math.round((covered / needed) * 100)) : 0;
  const full = covered >= needed - 0.01;
  return (
    <div data-testid="coverage-bar">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-ohana">Coverage</span>
        <span className="font-mono">
          {covered.toFixed(1)} / {needed} hr <span className={full ? "text-[#274f38]" : "text-[#B07C60]"}>· {pct}%</span>
        </span>
      </div>
      <div className="w-full h-2 bg-[#F0EFEA] rounded-full overflow-hidden">
        <div
          style={{ width: `${pct}%`, backgroundColor: full ? "#274f38" : "#B07C60" }}
          className="h-full transition-all duration-500"
        />
      </div>
    </div>
  );
}

function TherapistSummary({ t }) {
  return (
    <div className="flex items-center gap-3 py-2" data-testid={`team-member-${t.therapist_id}`}>
      <div className="w-9 h-9 rounded-full bg-[#E5EBE8] text-[#274f38] flex items-center justify-center text-sm font-medium">
        {t.therapist_name.split(" ").map(p => p[0]).slice(0, 2).join("")}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{t.therapist_name}</div>
        <div className="text-xs text-muted-ohana flex items-center gap-3 flex-wrap">
          <span className="capitalize">{t.skill_level}</span>
          {t.drive_minutes != null && (
            <span className="inline-flex items-center gap-1 font-mono"><Car size={10}/> {t.drive_minutes.toFixed(0)} min</span>
          )}
          {t.is_existing_relationship && (
            <span className="inline-flex items-center gap-1 text-[#B07C60]"><Heart size={10}/> Existing</span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-xs text-muted-ohana">Covers</div>
        <div className="font-mono text-sm">{t.covered_hours} hr</div>
      </div>
    </div>
  );
}

function OptionCard({ option, idx, isSelected, onSelect, testId }) {
  const isMulti = option.type === "multi";
  return (
    <div
      data-testid={testId}
      onClick={onSelect}
      className={`bg-surface rounded-lg p-5 cursor-pointer transition-all ${
        isSelected
          ? "border-2 border-[#274f38] shadow-[0_12px_32px_rgba(24,35,30,0.10)]"
          : "border border-soft card-shadow hover:shadow-[0_8px_24px_rgba(24,35,30,0.06)] hover:-translate-y-0.5"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-[#E5EBE8] text-[#274f38] flex items-center justify-center text-xs font-semibold">
            #{idx + 1}
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold">
              {isMulti ? `${option.therapists.length}-Therapist team` : "Single therapist"}
            </div>
            <div className="text-base font-medium" style={{ fontFamily: "Outfit" }}>
              {isMulti
                ? option.therapists.map(t => t.therapist_name.split(" ")[0]).join(" + ")
                : option.therapists[0].therapist_name}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-ohana font-semibold">Score</div>
          <div className="text-2xl font-medium text-[#274f38]" style={{ fontFamily: "Outfit" }}>{option.score}</div>
        </div>
      </div>

      <CoverageBar covered={option.coverage_hours} needed={option.needed_hours} />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {option.fully_covered ? (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#E8F0EA] text-[#274f38] font-medium">
            <CheckCircle2 size={11} /> Full coverage
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60] font-medium">
            <AlertTriangle size={11} /> {option.gap_hours} hr gap
          </span>
        )}
        {option.tags.filter(t => t !== "Full coverage" && t !== "Partial coverage").map(t => (
          <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-[#F0EFEA] text-[#586960]">{t}</span>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-soft space-y-1">
        {option.therapists.map(t => <TherapistSummary key={t.therapist_id} t={t} />)}
      </div>
    </div>
  );
}

export default function MatchingPage() {
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [client, setClient] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState("single");
  const [selectedOptionKey, setSelectedOptionKey] = useState(null);
  const [weekStart, setWeekStart] = useState(nextMonday());
  const [confirming, setConfirming] = useState(false);
  const [therapistFilter, setTherapistFilter] = useState("all"); // "all" | therapist_id
  const [blockDetail, setBlockDetail] = useState(null); // {block, kind, blockIndex?, clientDetails?}
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editedBlocks, setEditedBlocks] = useState(null); // null = use original; array = user-modified

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/clients");
      setClients(data);
    })();
  }, []);

  const run = async () => {
    if (!selectedClientId) {
      toast.error("Select a client first");
      return;
    }
    setLoading(true);
    setResult(null);
    setSelectedOptionKey(null);
    try {
      const c = clients.find(x => x.id === selectedClientId);
      setClient(c);
      const { data } = await api.post("/match/smart", { client_id: selectedClientId, max_results: 10 });
      setResult(data);
      const hasFullSingle = data.single_options.some(o => o.fully_covered);
      setTab(hasFullSingle ? "single" : (data.multi_options.length > 0 ? "multi" : "single"));
      // auto-select top option of active tab
      const top = (hasFullSingle ? data.single_options : (data.multi_options.length ? data.multi_options : data.single_options))[0];
      if (top) setSelectedOptionKey(`${top.type}-0`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally {
      setLoading(false);
    }
  };

  const optionList = useMemo(() => {
    if (!result) return [];
    return tab === "single" ? result.single_options : result.multi_options;
  }, [result, tab]);

  const selectedOption = useMemo(() => {
    if (!result || !selectedOptionKey) return null;
    const [t, idxStr] = selectedOptionKey.split("-");
    const list = t === "single" ? result.single_options : result.multi_options;
    return list[parseInt(idxStr)] || null;
  }, [result, selectedOptionKey]);

  const confirm = async () => {
    if (!selectedOption || !weekStart) return;
    setConfirming(true);
    try {
      const { data } = await api.post("/match/confirm", {
        client_id: result.client_id,
        week_start_date: weekStart,
        proposed_blocks: activeBlocks,
      });
      const skipped = data.skipped?.length || 0;
      toast.success(`Scheduled ${data.created} session${data.created !== 1 ? "s" : ""}${skipped ? ` (${skipped} skipped due to conflicts)` : ""}`);
      run();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally {
      setConfirming(false);
    }
  };

  // Reset filter & edits whenever a new option is selected
  useEffect(() => {
    setTherapistFilter("all");
    setEditedBlocks(null);
  }, [selectedOptionKey]);

  // Resolve the active blocks (user edits override the original proposal)
  const activeBlocks = useMemo(() => {
    if (!selectedOption) return [];
    return editedBlocks ?? selectedOption.proposed_blocks;
  }, [selectedOption, editedBlocks]);

  const editedHours = useMemo(() => {
    return activeBlocks.reduce((sum, b) => {
      const [sh, sm] = b.start.split(":").map(Number);
      const [eh, em] = b.end.split(":").map(Number);
      return sum + Math.max(0, ((eh * 60 + em) - (sh * 60 + sm)) / 60);
    }, 0);
  }, [activeBlocks]);

  const filteredProposed = useMemo(() => {
    if (!selectedOption) return [];
    if (therapistFilter === "all") return activeBlocks;
    return activeBlocks.filter(b => b.therapist_id === therapistFilter);
  }, [selectedOption, therapistFilter, activeBlocks]);

  const filteredExisting = useMemo(() => {
    if (!selectedOption) return [];
    const all = selectedOption.existing_blocks || [];
    if (therapistFilter === "all") return all;
    return all.filter(b => b.therapist_id === therapistFilter);
  }, [selectedOption, therapistFilter]);

  // Find the index of a block within activeBlocks (so we can identify it for editing)
  const findBlockIndex = (block) => {
    return activeBlocks.findIndex(b =>
      b.therapist_id === block.therapist_id &&
      b.day === block.day &&
      b.start === block.start &&
      b.end === block.end
    );
  };

  const handleBlockClick = async (block, kind) => {
    if (kind === "proposed") {
      const idx = findBlockIndex(block);
      setBlockDetail({ block: { ...block }, kind, blockIndex: idx });
      return;
    }
    setBlockDetail({ block, kind, clientDetails: null });
    if (kind === "existing" && block.client_id) {
      setLoadingDetail(true);
      try {
        const { data } = await api.get(`/clients/${block.client_id}`);
        setBlockDetail({ block, kind, clientDetails: data });
      } catch {
        // ignore
      } finally {
        setLoadingDetail(false);
      }
    }
  };

  const updateProposedBlock = (index, patch) => {
    const next = activeBlocks.slice();
    next[index] = { ...next[index], ...patch };
    setEditedBlocks(next);
  };

  const deleteProposedBlock = (index) => {
    const next = activeBlocks.filter((_, i) => i !== index);
    setEditedBlocks(next);
    setBlockDetail(null);
    toast.success("Block removed");
  };

  const addProposedBlock = () => {
    if (!selectedOption) return;
    const therapist = selectedOption.therapists[0];
    const newBlock = {
      therapist_id: therapist.therapist_id,
      therapist_name: therapist.therapist_name,
      day: 0,
      day_label: "Mon",
      start: "15:00",
      end: "17:00",
      hours: 2,
    };
    setEditedBlocks([...activeBlocks, newBlock]);
    setBlockDetail({ block: newBlock, kind: "proposed", blockIndex: activeBlocks.length });
  };

  const resetEdits = () => {
    setEditedBlocks(null);
    toast.success("Reset to original proposal");
  };

  // Live conflict count: any active block overlapping an existing block (same therapist+day) or another active block (same therapist+day)
  const conflictCount = useMemo(() => {
    if (!selectedOption) return 0;
    const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const overlaps = (s1, e1, s2, e2) => s1 < e2 && s2 < e1;
    let count = 0;
    activeBlocks.forEach((b, i) => {
      const bs = toMin(b.start), be = toMin(b.end);
      let conflicted = false;
      for (const ex of (selectedOption.existing_blocks || [])) {
        if (ex.day !== b.day) continue;
        if (ex.therapist_id && b.therapist_id && ex.therapist_id !== b.therapist_id) continue;
        if (overlaps(bs, be, toMin(ex.start), toMin(ex.end))) { conflicted = true; break; }
      }
      if (!conflicted) {
        for (let j = 0; j < activeBlocks.length; j++) {
          if (j === i) continue;
          const o = activeBlocks[j];
          if (o.day !== b.day || o.therapist_id !== b.therapist_id) continue;
          if (overlaps(bs, be, toMin(o.start), toMin(o.end))) { conflicted = true; break; }
        }
      }
      if (conflicted) count++;
    });
    return count;
  }, [selectedOption, activeBlocks]);

  return (
    <div>
      <PageHeader
        title="Smart matching"
        subtitle="Availability-aware therapist matching with proposed weekly schedule preview."
      />
      <div className="px-10 pb-10 space-y-6">
        {/* Step 1: Pick client */}
        <div className="bg-surface border border-soft rounded-lg p-6 card-shadow">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="text-xs tracking-[0.18em] uppercase text-muted-ohana font-semibold flex items-center gap-2">
                <UserPlus size={12} /> Step 1 · Select client
              </label>
              <select
                data-testid="match-client-select"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="mt-2 w-full h-11 px-4 rounded-md border border-soft bg-white text-sm"
              >
                <option value="">— choose a client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} · needs {c.needed_hours_per_week}hr/wk · {c.age_group}
                  </option>
                ))}
              </select>
            </div>
            <Button
              data-testid="run-smart-match-btn"
              onClick={run}
              disabled={loading || !selectedClientId}
              className="bg-primary-ohana hover:bg-[#1E3D2B] text-white h-11 px-6"
            >
              <Sparkles size={16} className="mr-2" /> {loading ? "Matching…" : "Run smart match"}
            </Button>
          </div>

          {client && (
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm pt-4 border-t border-soft" data-testid="match-client-summary">
              <div className="inline-flex items-center gap-1.5"><Clock size={13} /><span className="text-muted-ohana">Needs:</span> <span className="font-mono">{client.needed_hours_per_week} hr/wk</span></div>
              <div className="inline-flex items-center gap-1.5"><Award size={13} /><span className="text-muted-ohana">Skill required:</span> <span className="capitalize">{client.skill_required}</span></div>
              <div className="inline-flex items-center gap-1.5"><Heart size={13} /><span className="text-muted-ohana">Gender pref:</span> <span className="capitalize">{(client.gender_preference || "").replace("_", " ")}</span></div>
              <div className="inline-flex items-center gap-1.5"><MapPin size={13} /><span className="truncate max-w-md">{client.home_address}</span></div>
            </div>
          )}

          {result?.daily_targets && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs" data-testid="daily-targets-summary">
              <span className="text-muted-ohana">Hours per day:</span>
              {Object.entries(result.daily_targets).map(([day, hrs]) => (
                <span key={day} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#E5EBE8] text-[#274f38] font-mono">
                  {day} · {hrs}h
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Step 2: Options */}
        {result && (
          <>
            <Tabs value={tab} onValueChange={setTab} data-testid="match-tabs">
              <TabsList className="bg-muted-soft">
                <TabsTrigger value="single" data-testid="tab-single">
                  <Users size={14} className="mr-2" /> One therapist
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full bg-white text-muted-ohana">{result.single_options.length}</span>
                </TabsTrigger>
                <TabsTrigger value="multi" data-testid="tab-multi" disabled={result.multi_options.length === 0}>
                  <GitMerge size={14} className="mr-2" /> Multiple therapists
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded-full bg-white text-muted-ohana">{result.multi_options.length}</span>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="single" className="mt-4">
                {result.single_options.length === 0 && (
                  <div className="bg-[#FDF4E7] border border-[#E3C68B] rounded-md p-4 text-sm text-[#7A5B2E]">
                    No single therapist can cover this client based on current availability. Try the "Multiple therapists" tab.
                  </div>
                )}
                {!result.single_options.some(o => o.fully_covered) && result.single_options.length > 0 && (
                  <div className="bg-[#FDF4E7] border border-[#E3C68B] rounded-md p-4 text-sm text-[#7A5B2E] mb-4" data-testid="partial-warning">
                    No single therapist can fully cover the client's {result.needed_hours} hr/week. The options below offer partial coverage — consider a multi-therapist team instead.
                  </div>
                )}
              </TabsContent>
              <TabsContent value="multi" className="mt-4">
                {result.multi_options.length === 0 && (
                  <div className="bg-[#F0EFEA] border border-soft rounded-md p-4 text-sm text-muted-ohana">
                    Multi-therapist combinations are only generated when no single therapist can cover the client. The single-therapist tab is sufficient here.
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {optionList.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-6">
                {/* Left: option cards */}
                <div className="space-y-4">
                  {optionList.map((opt, idx) => (
                    <OptionCard
                      key={idx}
                      option={opt}
                      idx={idx}
                      isSelected={selectedOptionKey === `${opt.type}-${idx}`}
                      onSelect={() => setSelectedOptionKey(`${opt.type}-${idx}`)}
                      testId={`option-card-${opt.type}-${idx}`}
                    />
                  ))}
                </div>

                {/* Right: weekly preview */}
                <div className="space-y-4 lg:sticky lg:top-6 self-start">
                  <div className="bg-surface border border-soft rounded-lg p-5 card-shadow">
                    <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold flex items-center gap-2">
                          Step 2 · Preview
                          {editedBlocks && (
                            <span data-testid="modified-badge" className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60] normal-case tracking-normal">Modified</span>
                          )}
                        </div>
                        <h3 className="text-lg font-medium mt-0.5" style={{ fontFamily: "Outfit" }}>
                          Proposed weekly schedule
                        </h3>
                      </div>
                      {selectedOption && (
                        <div className="flex items-center gap-3">
                          {editedBlocks && (
                            <button
                              data-testid="reset-edits-btn"
                              onClick={resetEdits}
                              className="text-xs text-[#586960] hover:text-[#274f38] underline-offset-2 hover:underline"
                            >
                              Reset to original
                            </button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="add-block-btn"
                            onClick={addProposedBlock}
                          >
                            <Plus size={13} className="mr-1" /> Add block
                          </Button>
                          <div className="text-right">
                            <div className="text-xs text-muted-ohana">{activeBlocks.length} blocks</div>
                            <div className="font-mono text-sm">{editedHours.toFixed(1)} hr / wk</div>
                          </div>
                        </div>
                      )}
                    </div>
                    {conflictCount > 0 && (
                      <div data-testid="conflict-banner" className="mb-3 flex items-center gap-2 text-xs px-3 py-2 rounded-md bg-[#FCEBEB] border border-[#F4D6D6] text-[#B85C5C]">
                        <AlertTriangle size={13} />
                        <span>
                          {conflictCount} block{conflictCount > 1 ? "s" : ""} overlap{conflictCount === 1 ? "s" : ""} an existing booking or another proposed block. Drag, edit, or remove to resolve before confirming.
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-muted-ohana mb-2">Drag a block vertically to change time, horizontally to change day. Click to edit details.</p>

                    {selectedOption ? (
                      <>
                        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                          {selectedOption.therapists.map((t, i) => {
                            const colors = ["#274f38", "#B07C60", "#7B968B"];
                            return (
                              <span key={t.therapist_id} className="inline-flex items-center gap-1.5">
                                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors[i % colors.length] }}></span>
                                {t.therapist_name}
                              </span>
                            );
                          })}
                          {(selectedOption.existing_blocks || []).length > 0 && (
                            <span className="inline-flex items-center gap-1.5 text-muted-ohana">
                              <span
                                className="w-3 h-3 rounded-sm border border-[#A1ACA6]"
                                style={{ backgroundImage: "repeating-linear-gradient(135deg, #DCE3E0 0 3px, #E5EBE8 3px 6px)" }}
                              ></span>
                              Existing booking
                            </span>
                          )}
                        </div>

                        {selectedOption.therapists.length > 1 && (
                          <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="therapist-filter-chips">
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-ohana"><Filter size={11} /> Show:</span>
                            <button
                              type="button"
                              data-testid="filter-chip-all"
                              onClick={() => setTherapistFilter("all")}
                              className={`text-[11px] px-2.5 py-1 rounded-full transition-colors ${therapistFilter === "all" ? "bg-[#274f38] text-white" : "bg-[#F0EFEA] text-[#586960] hover:bg-[#E5EBE8]"}`}
                            >
                              All therapists
                            </button>
                            {selectedOption.therapists.map((t, i) => {
                              const colors = ["#274f38", "#B07C60", "#7B968B"];
                              const active = therapistFilter === t.therapist_id;
                              return (
                                <button
                                  type="button"
                                  key={t.therapist_id}
                                  data-testid={`filter-chip-${t.therapist_id}`}
                                  onClick={() => setTherapistFilter(t.therapist_id)}
                                  style={active ? { backgroundColor: colors[i % colors.length], color: "white" } : undefined}
                                  className={`text-[11px] px-2.5 py-1 rounded-full transition-colors flex items-center gap-1.5 ${!active && "bg-[#F0EFEA] text-[#586960] hover:bg-[#E5EBE8]"}`}
                                >
                                  {!active && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors[i % colors.length] }}></span>}
                                  {t.therapist_name}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <WeeklyPreview
                          blocks={filteredProposed}
                          existingBlocks={filteredExisting}
                          therapists={selectedOption.therapists}
                          onBlockClick={handleBlockClick}
                          onBlockMove={(idx, patch) => {
                            // idx is the index in filteredProposed; map back to activeBlocks
                            const block = filteredProposed[idx];
                            const realIdx = activeBlocks.indexOf(block);
                            const targetIdx = realIdx >= 0 ? realIdx : idx;
                            const dayLabels = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
                            updateProposedBlock(targetIdx, { ...patch, day_label: dayLabels[patch.day] });
                          }}
                        />
                      </>
                    ) : (
                      <div className="text-sm text-muted-ohana p-6 text-center">Select an option on the left to preview the weekly schedule.</div>
                    )}
                  </div>

                  {/* Confirm */}
                  {selectedOption && (
                    <div className="bg-surface border border-soft rounded-lg p-5 card-shadow" data-testid="confirm-panel">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-2">Step 3 · Schedule</div>
                      <div className="flex items-end gap-3">
                        <div className="flex-1">
                          <label className="text-xs text-muted-ohana mb-1 block">Apply starting Monday</label>
                          <Input
                            type="date"
                            data-testid="confirm-week-start"
                            value={weekStart}
                            onChange={(e) => setWeekStart(e.target.value)}
                          />
                        </div>
                        <Button
                          data-testid="confirm-match-btn"
                          onClick={confirm}
                          disabled={confirming || !weekStart || selectedOption.proposed_blocks.length === 0}
                          className="bg-primary-ohana hover:bg-[#1E3D2B] text-white"
                        >
                          <CalendarCheck size={16} className="mr-2" />
                          {confirming ? "Scheduling…" : `Confirm & schedule ${activeBlocks.length} block${activeBlocks.length !== 1 ? "s" : ""}`}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-ohana mt-2">
                        Sessions will be created on the week starting {weekStart}. Conflicts with existing bookings are skipped.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {!result && !loading && (
          <div className="bg-surface border border-soft rounded-lg p-10 text-center text-muted-ohana card-shadow">
            <Sparkles size={32} className="mx-auto mb-3 text-[#274f38]" />
            <div className="text-base font-medium text-[#18231E]">Select a client and run smart matching</div>
            <p className="text-sm mt-1 max-w-md mx-auto">
              We'll intersect their availability with each therapist's free time, prefer a single therapist for full coverage, and otherwise build a multi-therapist team.
            </p>
          </div>
        )}
      </div>

      {/* Block detail dialog */}
      <Dialog open={!!blockDetail} onOpenChange={(o) => !o && setBlockDetail(null)}>
        <DialogContent className="max-w-md bg-white" data-testid="block-detail-dialog">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Outfit" }}>
              {blockDetail?.kind === "existing" ? "Existing booking" : "Proposed session"}
            </DialogTitle>
          </DialogHeader>
          {blockDetail && (
            <div className="space-y-4 text-sm pt-2">
              {blockDetail.kind === "existing" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold">Day</div>
                    <div className="font-medium mt-1">{blockDetail.block.day_label}</div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold">Time</div>
                    <div className="font-mono mt-1">{blockDetail.block.start} – {blockDetail.block.end}</div>
                  </div>
                </div>
              )}

              {blockDetail.kind === "existing" ? (
                <>
                  <div className="border-t border-soft pt-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-2">Client</div>
                    {loadingDetail && <div className="text-xs text-muted-ohana">Loading details…</div>}
                    {blockDetail.clientDetails ? (
                      <div className="space-y-2">
                        <div className="text-base font-medium" style={{ fontFamily: "Outfit" }}>{blockDetail.clientDetails.name}</div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <div><span className="text-muted-ohana">Age group:</span> <span className="capitalize">{blockDetail.clientDetails.age_group}</span></div>
                          <div><span className="text-muted-ohana">Skill required:</span> <span className="capitalize">{blockDetail.clientDetails.skill_required}</span></div>
                          <div><span className="text-muted-ohana">Gender pref:</span> <span className="capitalize">{(blockDetail.clientDetails.gender_preference || "").replace("_", " ")}</span></div>
                          <div><span className="text-muted-ohana">Hours:</span> <span className="font-mono">{blockDetail.clientDetails.scheduled_hours_per_week || 0}/{blockDetail.clientDetails.needed_hours_per_week} hr/wk</span></div>
                        </div>
                        {blockDetail.clientDetails.home_address && (
                          <div className="text-xs text-muted-ohana inline-flex items-start gap-1.5"><MapPin size={12} className="mt-0.5 shrink-0" />{blockDetail.clientDetails.home_address}</div>
                        )}
                        {blockDetail.clientDetails.insurance?.plan && (
                          <div className="text-xs"><span className="text-muted-ohana">Insurance:</span> {blockDetail.clientDetails.insurance.plan} · {blockDetail.clientDetails.insurance.authorized_hours_per_week} hr authorized</div>
                        )}
                      </div>
                    ) : (
                      !loadingDetail && (
                        <div className="text-base font-medium">{blockDetail.block.client_name}</div>
                      )
                    )}
                  </div>
                  <div className="bg-[#FDF4E7] border border-[#E3C68B] text-[#7A5B2E] text-xs rounded-md p-3">
                    This time slot is already booked. The matcher routed around it automatically.
                  </div>
                </>
              ) : (
                <div className="border-t border-soft pt-4 space-y-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-2">Therapist</div>
                    {selectedOption && selectedOption.therapists.length > 1 ? (
                      <select
                        data-testid="edit-block-therapist"
                        value={blockDetail.block.therapist_id}
                        onChange={(e) => {
                          const t = selectedOption.therapists.find(x => x.therapist_id === e.target.value);
                          const next = { ...blockDetail.block, therapist_id: t.therapist_id, therapist_name: t.therapist_name };
                          setBlockDetail({ ...blockDetail, block: next });
                          if (blockDetail.blockIndex >= 0) {
                            updateProposedBlock(blockDetail.blockIndex, { therapist_id: t.therapist_id, therapist_name: t.therapist_name });
                          }
                        }}
                        className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm"
                      >
                        {selectedOption.therapists.map(t => (
                          <option key={t.therapist_id} value={t.therapist_id}>{t.therapist_name}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="text-base font-medium" style={{ fontFamily: "Outfit" }}>{blockDetail.block.therapist_name}</div>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-1">Day</div>
                      <select
                        data-testid="edit-block-day"
                        value={blockDetail.block.day}
                        onChange={(e) => {
                          const day = parseInt(e.target.value);
                          const dayLabels = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
                          const next = { ...blockDetail.block, day, day_label: dayLabels[day] };
                          setBlockDetail({ ...blockDetail, block: next });
                          if (blockDetail.blockIndex >= 0) {
                            updateProposedBlock(blockDetail.blockIndex, { day, day_label: dayLabels[day] });
                          }
                        }}
                        className="w-full h-10 px-3 rounded-md border border-soft bg-white text-sm"
                      >
                        {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d, i) => <option key={i} value={i}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-1">Start</div>
                      <Input
                        type="time"
                        data-testid="edit-block-start"
                        value={blockDetail.block.start}
                        onChange={(e) => {
                          const start = e.target.value;
                          const next = { ...blockDetail.block, start };
                          setBlockDetail({ ...blockDetail, block: next });
                          if (blockDetail.blockIndex >= 0) updateProposedBlock(blockDetail.blockIndex, { start });
                        }}
                      />
                    </div>
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-1">End</div>
                      <Input
                        type="time"
                        data-testid="edit-block-end"
                        value={blockDetail.block.end}
                        onChange={(e) => {
                          const end = e.target.value;
                          const next = { ...blockDetail.block, end };
                          setBlockDetail({ ...blockDetail, block: next });
                          if (blockDetail.blockIndex >= 0) updateProposedBlock(blockDetail.blockIndex, { end });
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="delete-block-btn"
                      onClick={() => deleteProposedBlock(blockDetail.blockIndex)}
                      className="text-[#B85C5C] border-[#F4D6D6] hover:bg-[#FCEBEB]"
                    >
                      <Trash2 size={14} className="mr-1.5" /> Remove block
                    </Button>
                    <Button
                      type="button"
                      data-testid="close-block-btn"
                      onClick={() => setBlockDetail(null)}
                      className="bg-primary-ohana hover:bg-[#1E3D2B] text-white"
                    >
                      Done
                    </Button>
                  </div>
                  <p className="text-xs text-muted-ohana">
                    Edits are local. Conflicts are checked on the server when you click "Confirm & schedule" — any block that conflicts with an existing booking is skipped (you'll see the count in the toast).
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
