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
  UserPlus, Clock, Award, Car, CalendarCheck, Users
} from "lucide-react";

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
        proposed_blocks: selectedOption.proposed_blocks,
      });
      const skipped = data.skipped?.length || 0;
      toast.success(`Scheduled ${data.created} session${data.created !== 1 ? "s" : ""}${skipped ? ` (${skipped} skipped due to conflicts)` : ""}`);
      // refresh smart match to show new state
      run();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally {
      setConfirming(false);
    }
  };

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
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold">Step 2 · Preview</div>
                        <h3 className="text-lg font-medium mt-0.5" style={{ fontFamily: "Outfit" }}>
                          Proposed weekly schedule
                        </h3>
                      </div>
                      {selectedOption && (
                        <div className="text-right">
                          <div className="text-xs text-muted-ohana">{selectedOption.proposed_blocks.length} blocks</div>
                          <div className="font-mono text-sm">{selectedOption.coverage_hours} hr / wk</div>
                        </div>
                      )}
                    </div>

                    {selectedOption ? (
                      <>
                        <div className="mb-3 flex flex-wrap gap-3 text-xs">
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
                        <WeeklyPreview
                          blocks={selectedOption.proposed_blocks}
                          existingBlocks={selectedOption.existing_blocks || []}
                          therapists={selectedOption.therapists}
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
                          {confirming ? "Scheduling…" : `Confirm & schedule ${selectedOption.proposed_blocks.length} blocks`}
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
    </div>
  );
}
