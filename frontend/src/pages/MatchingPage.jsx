import React, { useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "../lib/api";
import PageHeader from "../components/PageHeader";
import WeeklyPreview from "../components/WeeklyPreview";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { toast } from "sonner";
import {
  Sparkles, ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle,
  Users, Heart, MapPin, Award, Clock, Car, CalendarCheck,
  UserCheck, ClipboardList, GraduationCap,
} from "lucide-react";
import { nextMonday } from "../lib/dates";

// -------- Discipline configuration --------
const DISCIPLINES = [
  { key: "bt",              label: "BT",   long: "Behavior Intervention", icon: UserCheck,     defaultHours: 10,   description: "Primary direct-care therapist (10 hr/week)" },
  { key: "program_manager", label: "PM",   long: "Program Manager",       icon: ClipboardList, defaultHours: 2,    description: "Observes/supervises during BT sessions (2 hr/week)" },
  { key: "bcba",            label: "BCBA", long: "BCBA",                  icon: GraduationCap, defaultHours: 0.75, description: "Senior clinical oversight (~3 hr/month, during BT sessions)" },
];

const palette = ["#274f38", "#B07C60", "#7B968B"];

function CoverageBar({ covered, needed }) {
  const pct = needed > 0 ? Math.min(100, Math.round((covered / needed) * 100)) : 0;
  const full = covered >= needed - 0.01;
  return (
    <div data-testid="coverage-bar">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-ohana">Coverage</span>
        <span className="font-mono">
          {covered.toFixed(2)} / {needed} hr <span className={full ? "text-[#274f38]" : "text-[#B07C60]"}>· {pct}%</span>
        </span>
      </div>
      <div className="w-full h-2 bg-[#F0EFEA] rounded-full overflow-hidden">
        <div style={{ width: `${pct}%`, backgroundColor: full ? "#274f38" : "#B07C60" }} className="h-full transition-all duration-500" />
      </div>
    </div>
  );
}

function OptionCard({ option, idx, isSelected, onSelect, color, testId }) {
  const t = option.therapists[0];
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onSelect}
      className={`text-left bg-surface rounded-lg p-4 transition-all w-full ${
        isSelected
          ? "border-2 border-[#274f38] shadow-[0_12px_32px_rgba(24,35,30,0.10)]"
          : "border border-soft card-shadow hover:shadow-[0_8px_24px_rgba(24,35,30,0.06)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md flex items-center justify-center text-white text-xs font-semibold" style={{ backgroundColor: color }}>
            #{idx + 1}
          </div>
          <div>
            <div className="text-base font-medium" style={{ fontFamily: "Outfit" }}>{t.therapist_name}</div>
            <div className="text-[11px] text-muted-ohana flex items-center gap-2 capitalize">
              <span>{t.skill_level}</span>
              {t.drive_minutes != null && <span className="inline-flex items-center gap-1"><Car size={10}/> {t.drive_minutes.toFixed(0)} min</span>}
              {t.is_existing_relationship && <span className="text-[#B07C60] inline-flex items-center gap-1"><Heart size={10}/> existing</span>}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-ohana font-semibold">Score</div>
          <div className="text-2xl font-medium text-[#274f38]" style={{ fontFamily: "Outfit" }}>{option.score}</div>
        </div>
      </div>
      <CoverageBar covered={option.coverage_hours} needed={option.needed_hours} />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {option.fully_covered ? (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#E8F0EA] text-[#274f38] font-medium">
            <CheckCircle2 size={10} /> Full coverage
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60] font-medium">
            <AlertTriangle size={10} /> {option.gap_hours.toFixed(2)} hr gap
          </span>
        )}
      </div>
    </button>
  );
}

function StepDot({ active, complete, label, sublabel }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-colors ${
        complete ? "bg-[#274f38] text-white border-[#274f38]" :
        active ? "bg-white text-[#274f38] border-[#274f38]" :
        "bg-white text-muted-ohana border-soft"
      }`}>
        {complete ? <CheckCircle2 size={14} /> : label}
      </div>
      <div className="min-w-0">
        <div className={`text-xs uppercase tracking-[0.18em] font-semibold ${active || complete ? "text-[#274f38]" : "text-muted-ohana"}`}>{sublabel}</div>
      </div>
    </div>
  );
}

export default function MatchingPage() {
  const [clients, setClients] = useState([]);
  const [step, setStep] = useState(0); // 0=client, 1=BT, 2=PM, 3=BCBA, 4=review
  const [selectedClientId, setSelectedClientId] = useState("");
  const [client, setClient] = useState(null);
  const [teamHours, setTeamHours] = useState({ bt: 10, program_manager: 2, bcba: 0.75 });

  // Per-discipline match results + selections
  const [matches, setMatches] = useState({ bt: null, program_manager: null, bcba: null });
  const [picked, setPicked] = useState({ bt: null, program_manager: null, bcba: null });
  const [loadingDisc, setLoadingDisc] = useState(null);

  const [weekStart, setWeekStart] = useState(nextMonday());
  const [recurringWeeks, setRecurringWeeks] = useState(26);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await api.get("/clients");
      setClients(data);
    })();
  }, []);

  // ---- Client step ----
  const startMatching = async () => {
    if (!selectedClientId) { toast.error("Pick a client first"); return; }
    const c = clients.find(x => x.id === selectedClientId);
    setClient(c);
    setMatches({ bt: null, program_manager: null, bcba: null });
    setPicked({ bt: null, program_manager: null, bcba: null });
    const ch = c.team_hours || {};
    const merged = {
      bt: ch.bt ?? 10,
      program_manager: ch.program_manager ?? 2,
      bcba: ch.bcba ?? 0.75,
    };
    setTeamHours(merged);
    setStep(1);
    await loadMatch("bt", merged.bt, []);
  };

  // ---- Match loaders per discipline ----
  const anchorBlocksFromBT = () => {
    const bt = picked.bt;
    if (!bt) return [];
    return bt.proposed_blocks.map(b => ({ day: b.day, start: b.start, end: b.end }));
  };

  const loadMatch = async (discipline, target, anchorBlocks) => {
    setLoadingDisc(discipline);
    try {
      const { data } = await api.post("/match/smart", {
        client_id: selectedClientId,
        discipline,
        target_hours: target,
        anchor_blocks: anchorBlocks || [],
      });
      setMatches((prev) => ({ ...prev, [discipline]: data }));
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally {
      setLoadingDisc(null);
    }
  };

  const advanceTo = async (newStep) => {
    setStep(newStep);
    if (newStep === 2 && picked.bt && !matches.program_manager) {
      await loadMatch("program_manager", teamHours.program_manager, anchorBlocksFromBT());
    } else if (newStep === 3 && picked.bt && !matches.bcba) {
      await loadMatch("bcba", teamHours.bcba, anchorBlocksFromBT());
    }
  };

  const pickOption = (discipline, option) => {
    setPicked((prev) => ({ ...prev, [discipline]: option }));
  };

  // ---- Combined preview blocks + therapists ----
  const allTherapists = useMemo(() => {
    const out = [];
    if (picked.bt) out.push({ ...picked.bt.therapists[0], discipline: "bt" });
    if (picked.program_manager) out.push({ ...picked.program_manager.therapists[0], discipline: "program_manager" });
    if (picked.bcba) out.push({ ...picked.bcba.therapists[0], discipline: "bcba" });
    return out;
  }, [picked]);

  const allBlocks = useMemo(() => {
    const out = [];
    DISCIPLINES.forEach((d) => {
      const opt = picked[d.key];
      if (!opt) return;
      opt.proposed_blocks.forEach((b) => out.push({ ...b }));
    });
    return out;
  }, [picked]);

  const allExisting = useMemo(() => {
    const out = [];
    DISCIPLINES.forEach((d) => {
      const opt = picked[d.key];
      if (!opt) return;
      (opt.existing_blocks || []).forEach(b => out.push(b));
    });
    return out;
  }, [picked]);

  // ---- Confirm ----
  const confirmTeam = async () => {
    if (!picked.bt) { toast.error("Pick at least the BT before confirming."); return; }
    setConfirming(true);
    try {
      // Combine all proposed blocks across disciplines
      const proposed = [];
      DISCIPLINES.forEach((d) => {
        const opt = picked[d.key];
        if (!opt) return;
        opt.proposed_blocks.forEach(b => proposed.push(b));
      });
      const { data } = await api.post("/match/confirm", {
        client_id: selectedClientId,
        week_start_date: weekStart,
        proposed_blocks: proposed,
        recurring_weeks: recurringWeeks,
      });
      const skipped = data.skipped?.length || 0;
      toast.success(`Scheduled ${data.created} session${data.created !== 1 ? "s" : ""} across ${data.weeks_scheduled} weeks${skipped ? ` (${skipped} skipped)` : ""}`);
      // Reset
      setStep(0);
      setSelectedClientId("");
      setClient(null);
      setPicked({ bt: null, program_manager: null, bcba: null });
      setMatches({ bt: null, program_manager: null, bcba: null });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || e.message);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Team matching"
        subtitle="Build a complete care team — BT first, then PM and BCBA who join the BT's sessions."
      />

      {/* ---- Stepper ---- */}
      <div className="px-10 pt-2 pb-4">
        <div className="bg-surface border border-soft rounded-lg p-4 card-shadow flex items-center justify-between gap-3 flex-wrap" data-testid="wizard-stepper">
          {[
            { idx: 0, label: "1", sub: "Client" },
            { idx: 1, label: "2", sub: "BT" },
            { idx: 2, label: "3", sub: "Program Manager" },
            { idx: 3, label: "4", sub: "BCBA" },
            { idx: 4, label: "5", sub: "Review & schedule" },
          ].map((s, i, arr) => (
            <React.Fragment key={s.idx}>
              <StepDot
                active={step === s.idx}
                complete={step > s.idx && (s.idx === 0 ? !!client : (s.idx === 4 ? false : !!picked[["bt","program_manager","bcba"][s.idx - 1]]))}
                label={s.label}
                sublabel={s.sub}
              />
              {i < arr.length - 1 && <div className="flex-1 h-px bg-[#E3DFD5] hidden md:block"></div>}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="px-10 pb-10 space-y-5">
        {/* ---- STEP 0: client ---- */}
        {step === 0 && (
          <div className="bg-surface border border-soft rounded-lg p-6 card-shadow" data-testid="step-client">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-2">Step 1 · Pick a client</div>
            <h2 className="text-xl mb-4" style={{ fontFamily: "Outfit" }}>Who needs a care team?</h2>
            <div className="flex items-end gap-3">
              <select
                data-testid="match-client-select"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                className="flex-1 h-11 px-4 rounded-md border border-soft bg-white text-sm"
              >
                <option value="">— choose a client —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.name} · needs {c.needed_hours_per_week}hr/wk · {c.age_group}</option>
                ))}
              </select>
              <Button
                data-testid="start-matching-btn"
                onClick={startMatching}
                disabled={!selectedClientId}
                className="bg-primary-ohana hover:bg-[#1E3D2B] text-white h-11 px-6"
              >
                <Sparkles size={16} className="mr-2" /> Start matching
              </Button>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {DISCIPLINES.map((d, i) => (
                <div key={d.key} className="border border-soft rounded-md p-3 bg-[#F9F8F5]">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center text-white" style={{ backgroundColor: palette[i] }}>
                      <d.icon size={16}/>
                    </div>
                    <div>
                      <div className="text-sm font-medium">{d.long}</div>
                      <div className="text-[11px] text-muted-ohana">{d.defaultHours} hr/wk default</div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-ohana mt-2">{d.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- STEPS 1-3: discipline matching ---- */}
        {step >= 1 && step <= 3 && client && (
          <DisciplineStep
            stepIdx={step}
            disciplineKey={["bt","program_manager","bcba"][step - 1]}
            client={client}
            teamHours={teamHours}
            matches={matches}
            picked={picked}
            allBlocks={allBlocks}
            allExisting={allExisting}
            allTherapists={allTherapists}
            loadingDisc={loadingDisc}
            onPick={pickOption}
            onBack={() => advanceTo(step - 1)}
            onNext={() => advanceTo(step + 1)}
            onSkip={() => advanceTo(step + 1)}
          />
        )}

        {/* ---- STEP 4: review & confirm ---- */}
        {step === 4 && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5" data-testid="step-review">
            <div className="space-y-4">
              <div className="bg-surface border border-soft rounded-lg p-5 card-shadow">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-2">Step 5 · Review the team</div>
                <h2 className="text-xl mb-4" style={{ fontFamily: "Outfit" }}>Confirm care team for {client?.name}</h2>
                <div className="space-y-2">
                  {DISCIPLINES.map((d, i) => {
                    const opt = picked[d.key];
                    return (
                      <div key={d.key} className="border border-soft rounded-md p-3 flex items-center gap-3" data-testid={`review-${d.key}`}>
                        <div className="w-9 h-9 rounded-md flex items-center justify-center text-white" style={{ backgroundColor: palette[i] }}>
                          <d.icon size={16}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-ohana font-semibold">{d.long}</div>
                          {opt ? (
                            <>
                              <div className="font-medium">{opt.therapists[0].therapist_name}</div>
                              <div className="text-[11px] text-muted-ohana">
                                {opt.coverage_hours.toFixed(2)} / {opt.needed_hours} hr per week
                                {opt.gap_hours > 0 && ` · ${opt.gap_hours.toFixed(2)} hr gap`}
                              </div>
                            </>
                          ) : (
                            <div className="text-sm text-muted-ohana italic">— skipped —</div>
                          )}
                        </div>
                        {opt ? <CheckCircle2 size={18} className="text-[#274f38]"/> : <span className="text-xs text-muted-ohana">optional</span>}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-surface border border-soft rounded-lg p-5 card-shadow space-y-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold">Recurrence</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-ohana">Start the week of</label>
                    <Input type="date" data-testid="confirm-week-start" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-ohana">Recurring weeks</label>
                    <Input
                      type="number"
                      min={1}
                      max={104}
                      data-testid="confirm-recurring-weeks"
                      value={recurringWeeks}
                      onChange={(e) => setRecurringWeeks(parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-ohana">
                  Sessions repeat weekly until you cancel the series. Default is 26 weeks (~6 months).
                </p>
                <Button
                  data-testid="confirm-team-btn"
                  onClick={confirmTeam}
                  disabled={confirming || !picked.bt}
                  className="w-full bg-primary-ohana hover:bg-[#1E3D2B] text-white"
                >
                  <CalendarCheck size={16} className="mr-2" />
                  {confirming ? "Scheduling…" : "Confirm & schedule recurring team"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStep(3)}
                  className="w-full"
                >
                  <ArrowLeft size={14} className="mr-1.5"/> Back to BCBA step
                </Button>
              </div>
            </div>

            <div className="bg-surface border border-soft rounded-lg p-5 card-shadow lg:sticky lg:top-6 self-start">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-2">Combined weekly schedule</div>
              <h3 className="text-lg mb-3" style={{ fontFamily: "Outfit" }}>{allBlocks.length} blocks · {allBlocks.reduce((s, b) => {
                const [sh, sm] = b.start.split(":").map(Number);
                const [eh, em] = b.end.split(":").map(Number);
                return s + ((eh*60+em) - (sh*60+sm)) / 60;
              }, 0).toFixed(1)} hr / wk</h3>
              <div className="mb-3 flex flex-wrap gap-3 text-xs">
                {allTherapists.map((t, i) => (
                  <span key={t.therapist_id} className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: palette[i % palette.length] }}></span>
                    {t.therapist_name} <span className="text-muted-ohana">({DISCIPLINES.find(d=>d.key===t.discipline)?.label})</span>
                  </span>
                ))}
              </div>
              <WeeklyPreview blocks={allBlocks} existingBlocks={allExisting} therapists={allTherapists} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Discipline step (BT, PM, or BCBA) ---
function DisciplineStep({ stepIdx, disciplineKey, client, teamHours, matches, picked, allBlocks, allExisting, allTherapists, loadingDisc, onPick, onBack, onNext, onSkip }) {
  const d = DISCIPLINES.find(x => x.key === disciplineKey);
  const result = matches[disciplineKey];
  const target = teamHours[disciplineKey];
  const selected = picked[disciplineKey];
  const isLoading = loadingDisc === disciplineKey;
  const opts = result?.single_options || [];
  const noOptions = !isLoading && result && opts.length === 0;
  const colorIdx = DISCIPLINES.findIndex(x => x.key === disciplineKey);
  const accentColor = palette[colorIdx];

  // Build preview combining current selections + the option being inspected (preview)
  const [hovered, setHovered] = useState(null);
  const previewBlocks = useMemo(() => {
    const blocks = [];
    DISCIPLINES.forEach((dd) => {
      const opt = dd.key === disciplineKey ? (selected || hovered) : picked[dd.key];
      if (!opt) return;
      opt.proposed_blocks.forEach(b => blocks.push(b));
    });
    return blocks;
  }, [picked, selected, hovered, disciplineKey]);

  const previewTherapists = useMemo(() => {
    const out = [];
    DISCIPLINES.forEach((dd) => {
      const opt = dd.key === disciplineKey ? (selected || hovered) : picked[dd.key];
      if (!opt) return;
      out.push({ ...opt.therapists[0], discipline: dd.key });
    });
    return out;
  }, [picked, selected, hovered, disciplineKey]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-5" data-testid={`step-${disciplineKey}`}>
      {/* Left: option list */}
      <div className="space-y-3">
        <div className="bg-surface border border-soft rounded-lg p-5 card-shadow">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold">Step {stepIdx + 1} · {d.long}</div>
            {disciplineKey !== "bt" && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#FDF4E7] text-[#B07C60] uppercase tracking-wider">Joins BT sessions</span>
            )}
          </div>
          <h2 className="text-xl mt-1" style={{ fontFamily: "Outfit" }}>Pick a {d.label}</h2>
          <p className="text-sm text-muted-ohana mt-1">
            Need <span className="font-mono">{target}</span> hr/week. {disciplineKey !== "bt" && "Available windows are constrained to overlap the BT's proposed schedule."}
          </p>
        </div>

        {isLoading && (
          <div className="text-sm text-muted-ohana px-2" data-testid="step-loading">Computing matches…</div>
        )}

        {noOptions && (
          <div className="bg-[#FDF4E7] border border-[#E3C68B] rounded-md p-4 text-sm text-[#7A5B2E]" data-testid="step-no-options">
            No {d.label} matches the BT's schedule.
            {disciplineKey !== "bt"
              ? ` Make sure at least one therapist is tagged as “${d.long}” in Therapists, with availability that overlaps the BT's proposed blocks.`
              : ` Add a BT therapist with availability that overlaps the client's window.`}
          </div>
        )}

        {opts.map((o, i) => (
          <div
            key={i}
            onMouseEnter={() => setHovered(o)}
            onMouseLeave={() => setHovered(null)}
          >
            <OptionCard
              option={o}
              idx={i}
              color={accentColor}
              isSelected={selected === o}
              onSelect={() => onPick(disciplineKey, selected === o ? null : o)}
              testId={`option-${disciplineKey}-${i}`}
            />
          </div>
        ))}

        <div className="flex items-center justify-between gap-3 pt-3">
          <Button variant="outline" onClick={onBack} data-testid="step-back">
            <ArrowLeft size={14} className="mr-1.5" /> Back
          </Button>
          <div className="flex gap-2">
            {disciplineKey !== "bt" && (
              <Button variant="outline" onClick={onSkip} data-testid="step-skip">Skip {d.label}</Button>
            )}
            <Button
              onClick={onNext}
              disabled={disciplineKey === "bt" && !selected}
              className="bg-primary-ohana hover:bg-[#1E3D2B] text-white"
              data-testid="step-next"
            >
              {selected ? `Continue with ${selected.therapists[0].therapist_name.split(" ")[0]}` : "Continue"} <ArrowRight size={14} className="ml-1.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Right: live weekly preview */}
      <div className="bg-surface border border-soft rounded-lg p-5 card-shadow lg:sticky lg:top-6 self-start">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-ohana font-semibold mb-1">Live preview</div>
        <h3 className="text-lg" style={{ fontFamily: "Outfit" }}>Team week so far</h3>
        <p className="text-xs text-muted-ohana mb-3">Hover an option on the left to preview it; click to pick.</p>
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {previewTherapists.map((t, i) => (
            <span key={t.therapist_id} className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: palette[i % palette.length] }}></span>
              {t.therapist_name}
              <span className="text-muted-ohana">({DISCIPLINES.find(dd => dd.key === t.discipline)?.label})</span>
            </span>
          ))}
          {previewTherapists.length === 0 && <span className="text-muted-ohana">No selections yet.</span>}
        </div>
        <WeeklyPreview blocks={previewBlocks} existingBlocks={[]} therapists={previewTherapists} />
        <div className="mt-3 text-xs text-muted-ohana inline-flex items-center gap-1.5">
          <MapPin size={12}/> Client: {client.home_address}
        </div>
      </div>
    </div>
  );
}
