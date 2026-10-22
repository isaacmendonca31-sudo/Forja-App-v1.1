/**
 * FORJA — Tela de treino em andamento (registro rápido, série a série).
 *
 * Princípios de UX aplicados:
 *  • Registro com poucos toques: valores da última sessão aparecem como sugestão
 *    (placeholder) e o ✓ confirma; basta digitar o que mudou.
 *  • Rascunho salvo automaticamente: fechar o app ou perder a bateria não perde o treino.
 *  • Cronômetro de descanso inicia ao concluir cada série.
 *  • Trocar exercício e "máquina ocupada" mudam só ESTE treino; a ficha só é
 *    alterada se o usuário marcar explicitamente "aplicar também à ficha".
 */
import {
  h, icon, uid, isoDate, parseDecimal, fmtNum, fmtDateShort, debounce,
} from '../utils.js';
import {
  getPlan, savePlan, getSessions, getAllExercises, getExercise, getSettings,
  loadDraft, saveDraft, clearDraft, addSession,
} from '../store.js';
import { GROUPS, EQUIPMENT } from '../data/library.js';
import {
  exerciseHistory, suggestProgression, rankAlternatives, suggestBusy,
} from '../suggest.js';
import { startRest, stopRest } from '../timer.js';
import { pageHead, modal, confirmDialog, toast, banner } from '../ui.js';

const smoothOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

// ───────────── Criação do rascunho a partir da ficha ─────────────
function buildItem(exerciseId, planned, planItemId, planNote = '') {
  const ex = getExercise(exerciseId);
  return {
    key: uid(),
    planItemId,
    exerciseId,
    name: ex?.name ?? 'Exercício',
    group: ex?.group ?? 'peito',
    type: ex?.type ?? 'isolador',
    portion: ex?.portion ?? '',
    equipment: ex?.equipment ?? 'outro',
    planned: { sets: planned.sets, repMin: planned.repMin, repMax: planned.repMax },
    planNote,
    note: '',
    skipped: false,
    doneAt: 0,
    sets: Array.from({ length: planned.sets }, () => ({ weight: '', reps: '', done: false })),
  };
}

function createDraft(day) {
  return {
    id: uid(),
    dayId: day.id,
    title: day.title,
    date: isoDate(),
    startedAt: Date.now(),
    note: '',
    items: day.items.map((it) => buildItem(it.exerciseId, it, it.id, it.note)),
  };
}

// ───────────── Tela ─────────────
export function render({ params, navigate, rerender }) {
  const plan = getPlan();
  const day = plan.days.find((d) => d.id === params.id);
  if (!day) {
    return {
      title: 'Treino não encontrado',
      el: h('div', { class: 'view' }, pageHead('Treino não encontrado', { back: '#/' }),
        h('a', { class: 'btn primary', href: '#/' }, 'Voltar ao início')),
    };
  }

  let draft = loadDraft();

  // Já existe outro treino em andamento: o usuário decide (nada é descartado sozinho).
  if (draft && draft.dayId !== day.id) {
    const other = draft;
    return {
      title: 'Treino em andamento',
      el: h('div', { class: 'view' },
        pageHead('Treino em andamento', { back: '#/' }),
        banner('warn',
          h('p', {}, `Você já tem um treino em andamento: `, h('strong', {}, other.title), '.'),
          h('div', { class: 'stack' },
            h('a', { class: 'btn primary', href: `#/treino/${other.dayId}` }, 'Continuar esse treino'),
            h('button', {
              type: 'button', class: 'btn danger',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: 'Descartar o treino em andamento?',
                  message: `As séries registradas em "${other.title}" serão perdidas.`,
                  confirmLabel: 'Descartar e iniciar este', danger: true,
                });
                if (ok) { clearDraft(); rerender(); }
              },
            }, `Descartar e iniciar ${day.title}`)))),
    };
  }

  if (!draft) { draft = createDraft(day); saveDraft(draft); }

  const settings = getSettings();
  const unavailable = new Set(settings.unavailableEquipment);
  const persist = debounce(() => saveDraft(draft), 250);
  const sessions = getSessions();
  const histCache = new Map(); // exerciseId → último registro

  const lastOf = (exerciseId) => {
    if (!histCache.has(exerciseId)) histCache.set(exerciseId, exerciseHistory(sessions, exerciseId).at(-1) ?? null);
    return histCache.get(exerciseId);
  };

  // ───── Progresso geral ─────
  const progressText = h('span', { class: 'muted' });
  const progressBar = h('div', {
    class: 'progress', role: 'progressbar', 'aria-label': 'Séries concluídas',
    'aria-valuemin': '0',
  }, h('span'));

  const activeItems = () => draft.items.filter((i) => !i.skipped);
  const totals = () => {
    const all = activeItems().flatMap((i) => i.sets);
    return { total: all.length, done: all.filter((s) => s.done).length };
  };
  function updateProgress() {
    const { total, done } = totals();
    progressText.textContent = `${done} de ${total} séries`;
    progressBar.setAttribute('aria-valuemax', String(total));
    progressBar.setAttribute('aria-valuenow', String(done));
    progressBar.firstChild.style.setProperty('--pct', `${total ? (done / total) * 100 : 0}%`);
  }

  // Destaca o primeiro exercício ainda não concluído ("Próximo").
  function markCurrent() {
    const cur = draft.items.find((i) => !i.skipped && !i.sets.every((s) => s.done));
    list.querySelectorAll('.card').forEach((c) => c.classList.toggle('current', cur && c.dataset.key === cur.key));
  }

  // ───── Cartão de exercício ─────
  function renderCard(item) {
    const last = lastOf(item.exerciseId);
    const step = getExercise(item.exerciseId)?.step ?? 2.5;
    const progression = suggestProgression(item.planned, last, step);
    const card = h('section', { class: 'card', 'aria-label': item.name, dataset: { key: item.key } });

    const head = h('div', { class: 'card-head' },
      h('h2', {}, item.name),
      h('span', { class: 'tag' }, GROUPS[item.group] ?? ''));

    if (item.skipped) {
      card.classList.add('skipped');
      card.append(head,
        h('p', { class: 'muted' }, 'Exercício pulado neste treino.'),
        h('button', { type: 'button', class: 'btn small', onClick: () => { item.skipped = false; persist(); repaintCard(item); updateProgress(); markCurrent(); } }, 'Desfazer'));
      return card;
    }

    card.append(...[head,
      h('p', {},
        h('span', { class: 'target' }, `${item.planned.sets} × ${item.planned.repMin}–${item.planned.repMax}`),
        h('span', { class: 'muted' }, ` · ${EQUIPMENT[item.equipment] ?? ''}${item.type === 'composto' ? ' · composto' : ''}`)),
      item.planNote ? h('p', { class: 'hint' }, item.planNote) : null,
      last
        ? h('p', { class: 'last-time' }, `Anterior (${fmtDateShort(last.date)}): `,
          last.sets.map((s) => `${fmtNum(s.weight)}×${s.reps}`).join(' · '))
        : h('p', { class: 'last-time' }, 'Sem registro anterior deste exercício.')].filter(Boolean)); // filter: append(null) escreveria "null" na tela

    // Sugestão de progressão: apenas informa; o usuário decide aplicar.
    if (progression) {
      const box = h('div', { class: `banner ${progression.type === 'increase' ? 'ok' : ''}` },
        h('p', {}, h('strong', {}, 'Sugestão'), progression.message));
      if (progression.type === 'increase') {
        box.append(h('button', {
          type: 'button', class: 'btn small',
          onClick: () => {
            item.sets.forEach((s) => { if (!s.done) s.weight = String(progression.to).replace('.', ','); });
            persist(); repaintCard(item);
          },
        }, `Usar ${fmtNum(progression.to)} kg nas séries`));
      }
      card.append(box);
    }

    // Séries
    card.append(h('div', { class: 'set-heads', 'aria-hidden': 'true' },
      h('span', {}, 'Série'), h('span', {}, 'Carga (kg)'), h('span', {}, 'Reps'), h('span', {}, '')));
    const status = h('p', { class: 'error-text', role: 'alert' });
    const rows = h('div', { class: 'stack' });
    item.sets.forEach((_, i) => rows.append(setRow(item, i, status)));
    card.append(rows, status);

    // Ações do exercício
    card.append(h('div', { class: 'card-actions' },
      h('button', { type: 'button', class: 'btn small', onClick: () => { item.sets.push({ weight: '', reps: '', done: false }); persist(); repaintCard(item); updateProgress(); } }, icon('plus'), 'Série'),
      item.sets.length > 1 && !item.sets.at(-1).done
        ? h('button', { type: 'button', class: 'btn small ghost', 'aria-label': 'Remover última série', onClick: () => { item.sets.pop(); persist(); repaintCard(item); updateProgress(); } }, icon('minus'), 'Série')
        : null,
      h('button', { type: 'button', class: 'btn small', onClick: () => openSwap(item) }, icon('swap'), 'Trocar'),
      h('button', { type: 'button', class: 'btn small', onClick: () => openBusy(item) }, 'Máquina ocupada'),
      h('button', { type: 'button', class: 'btn small ghost', 'aria-label': `Como executar ${item.name}`, onClick: () => openInfo(item) }, icon('info'), 'Como fazer')));

    // Observações do exercício
    const details = h('details', { open: item.note ? true : null },
      h('summary', {}, 'Observações'),
      h('textarea', {
        class: 'input', maxlength: '500', 'aria-label': `Observações de ${item.name}`,
        placeholder: 'Ex.: ajuste do banco, dor, sensação…', value: item.note,
        onInput: (e) => { item.note = e.target.value; persist(); },
      }));
    card.append(details);

    if (!item.sets.some((s) => s.done)) {
      card.append(h('button', {
        type: 'button', class: 'link-btn',
        onClick: () => { item.skipped = true; persist(); repaintCard(item); updateProgress(); markCurrent(); },
      }, 'Pular exercício'));
    }
    return card;
  }

  function setRow(item, i, status) {
    const s = item.sets[i];
    const last = lastOf(item.exerciseId);
    const ref = last ? (last.sets[i] ?? last.sets.at(-1)) : null;
    const phW = ref ? String(ref.weight).replace('.', ',') : '';
    const phR = ref ? String(ref.reps) : '';

    const w = h('input', {
      class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off', maxlength: '7',
      'aria-label': `Série ${i + 1}, carga em quilos`, placeholder: phW || 'kg', value: s.weight,
      readonly: s.done || null,
      onInput: (e) => { s.weight = e.target.value; e.target.removeAttribute('aria-invalid'); persist(); },
    });
    const r = h('input', {
      class: 'input', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '3',
      'aria-label': `Série ${i + 1}, repetições`, placeholder: phR || 'reps', value: s.reps,
      readonly: s.done || null,
      onInput: (e) => { s.reps = e.target.value; e.target.removeAttribute('aria-invalid'); persist(); },
    });
    const btn = h('button', {
      type: 'button', class: 'done-btn', 'aria-pressed': String(s.done),
      'aria-label': `Série ${i + 1}: ${s.done ? 'desmarcar' : 'marcar como feita'}`,
    }, icon('check'));

    btn.addEventListener('click', () => {
      status.textContent = '';
      if (s.done) { // desfazer
        s.done = false;
      } else {
        const weight = parseDecimal(s.weight !== '' ? s.weight : phW);
        const reps = /^\d{1,3}$/.test((s.reps !== '' ? s.reps : phR).trim()) ? Number((s.reps !== '' ? s.reps : phR).trim()) : NaN;
        const badW = !(weight >= 0 && weight <= 1000);
        const badR = !(reps >= 1 && reps <= 100);
        if (badW) w.setAttribute('aria-invalid', 'true'); else w.removeAttribute('aria-invalid');
        if (badR) r.setAttribute('aria-invalid', 'true'); else r.removeAttribute('aria-invalid');
        if (badW || badR) {
          status.textContent = `Série ${i + 1}: informe a carga (0 a 1000 kg) e as repetições (1 a 100).`;
          (badW ? w : r).focus();
          return;
        }
        s.weight = String(weight);
        s.reps = String(reps);
        s.done = true;
        item.doneAt = Date.now();
        w.value = s.weight; r.value = s.reps;

        const { total, done } = totals();
        if (done >= total) { // esta era a última série pendente do treino
          stopRest();
          toast('Todas as séries concluídas. Toque em "Finalizar treino".');
        } else {
          const secs = item.type === 'composto' ? getSettings().restCompound : getSettings().restIsolation;
          startRest(secs, `Descanso · ${item.name}`);
        }
      }
      w.readOnly = s.done; r.readOnly = s.done;
      btn.setAttribute('aria-pressed', String(s.done));
      btn.setAttribute('aria-label', `Série ${i + 1}: ${s.done ? 'desmarcar' : 'marcar como feita'}`);
      persist(); updateProgress(); markCurrent();
    });

    return h('div', { class: 'set-row' }, h('span', { class: 'set-n' }, String(i + 1)), w, r, btn);
  }

  function repaintCard(item) {
    const old = list.querySelector(`[data-key="${item.key}"]`);
    const fresh = renderCard(item);
    if (old) old.replaceWith(fresh); else list.append(fresh);
    markCurrent();
  }
  function paintAll() {
    list.replaceChildren(...draft.items.map(renderCard));
    markCurrent();
  }
  function focusCard(item) {
    const el = list.querySelector(`[data-key="${item.key}"]`);
    el?.scrollIntoView({ behavior: smoothOK() ? 'smooth' : 'auto', block: 'start' });
    el?.querySelector('input')?.focus({ preventScroll: true });
  }

  // ───── Trocar exercício (mesmo músculo/porção) ─────
  const targetOf = (item) => ({
    exerciseId: item.exerciseId, group: item.group, portion: item.portion, type: item.type, equipment: item.equipment,
  });

  function applySwap(item, ex, alsoPlan) {
    item.exerciseId = ex.id; item.name = ex.name; item.group = ex.group; item.type = ex.type;
    item.portion = ex.portion; item.equipment = ex.equipment; item.planNote = '';
    item.sets.forEach((s) => { s.weight = ''; s.reps = ''; });
    if (alsoPlan && item.planItemId) { // alteração PERMANENTE: só com autorização explícita
      const p = structuredClone(getPlan());
      const pi = p.days.find((d) => d.id === draft.dayId)?.items.find((i) => i.id === item.planItemId);
      if (pi) { pi.exerciseId = ex.id; pi.note = ''; savePlan(p); }
    }
    persist(); repaintCard(item);
    toast(`Trocado por ${ex.name}${alsoPlan ? ' (e na ficha)' : ' (só neste treino)'}.`);
  }

  function altButtons(item, alts, alsoPlanInput, close) {
    return h('ul', { class: 'pick' }, alts.map(({ exercise: ex, reasons }) => h('li', {},
      h('button', {
        type: 'button', class: 'list-item',
        onClick: () => { applySwap(item, ex, Boolean(alsoPlanInput?.checked)); close(); },
      },
      h('span', { class: 'grow' },
        h('span', { class: 'title' }, ex.name), h('br'),
        h('span', { class: 'meta' }, reasons.join(' · ')))))));
  }

  function openSwap(item) {
    if (item.sets.some((s) => s.done)) { toast('Este exercício já tem séries registradas e não pode ser trocado.'); return; }
    const used = new Set(draft.items.map((i) => i.exerciseId));
    const alts = rankAlternatives(targetOf(item), getAllExercises(), { exclude: used, unavailable, limit: 8 });
    const alsoPlan = h('input', { type: 'checkbox', id: 'swap-plan' });
    let handle;
    const body = h('div', { class: 'stack' },
      h('p', { class: 'muted' }, `Alternativas para ${GROUPS[item.group]} (${item.portion || 'geral'}), da melhor para a menos equivalente.`),
      alts.length ? altButtons(item, alts, alsoPlan, () => handle.close()) : h('p', {}, 'Nenhuma alternativa disponível com os equipamentos atuais.'),
      item.planItemId ? h('label', { class: 'check', for: 'swap-plan' }, alsoPlan, h('span', {}, `Aplicar também à ficha de ${day.name} (permanente)`)) : null);
    handle = modal({ title: `Trocar ${item.name}`, body, actions: [{ label: 'Cancelar', kind: 'ghost' }] });
  }

  // ───── Máquina ocupada ─────
  function moveItem(from, toIndex) {
    const [it] = draft.items.splice(from, 1);
    draft.items.splice(toIndex, 0, it);
  }

  function openBusy(item) {
    const idx = draft.items.indexOf(item);
    const { next, lastGroup } = suggestBusy(draft.items, idx);
    const used = new Set(draft.items.map((i) => i.exerciseId));
    const canSwap = !item.sets.some((s) => s.done);
    const alts = canSwap
      ? rankAlternatives(targetOf(item), getAllExercises(), { exclude: used, unavailable, avoidSameEquipment: true, limit: 3 })
      : [];
    let handle;
    const body = h('div', { class: 'stack' },
      h('p', { class: 'muted' }, `Aparelho de "${item.name}" ocupado. Escolha como seguir — a ficha não será alterada.`),
      lastGroup ? h('p', { class: 'hint' }, `Último músculo trabalhado: ${GROUPS[lastGroup]}.`) : null);

    if (next) {
      body.append(h('h3', {}, 'Fazer outro exercício agora'),
        h('button', {
          type: 'button', class: 'list-item',
          onClick: () => {
            const ni = draft.items.indexOf(next.item);
            moveItem(draft.items.indexOf(item), ni); // o ocupado volta logo depois do próximo
            persist(); paintAll(); handle.close();
            toast(`Siga com ${next.item.name}; ${item.name} fica para depois.`);
            focusCard(next.item);
          },
        }, h('span', { class: 'grow' },
          h('span', { class: 'title' }, next.item.name), h('br'),
          h('span', { class: 'meta' }, next.reason))));
    } else {
      body.append(h('p', {}, 'Não há outros exercícios pendentes neste treino.'));
    }

    if (alts.length) {
      body.append(h('h3', {}, 'Ou trocar por equivalente (mesma porção)'),
        altButtons(item, alts, null, () => handle.close()));
    }
    body.append(h('button', {
      type: 'button', class: 'btn',
      onClick: () => { moveItem(draft.items.indexOf(item), draft.items.length - 1); persist(); paintAll(); handle.close(); toast(`${item.name} movido para o final.`); },
    }, 'Deixar para o final'));

    handle = modal({ title: 'Máquina ocupada', body, actions: [{ label: 'Cancelar', kind: 'ghost' }] });
  }

  function openInfo(item) {
    const ex = getExercise(item.exerciseId);
    modal({
      title: item.name,
      body: h('div', { class: 'stack' },
        h('div', { class: 'row wrap' },
          h('span', { class: 'tag' }, GROUPS[item.group]),
          item.portion ? h('span', { class: 'tag' }, item.portion) : null,
          h('span', { class: 'tag' }, EQUIPMENT[item.equipment] ?? '')),
        h('p', {}, ex?.how || 'Sem instruções cadastradas.'),
        h('p', { class: 'hint' }, 'Em caso de dor, interrompa o exercício. Orientação básica; não substitui acompanhamento profissional.')),
      actions: [{ label: 'Fechar', kind: 'primary' }],
    });
  }

  // ───── Finalizar / descartar ─────
  async function discard() {
    const ok = await confirmDialog({
      title: 'Descartar este treino?', message: 'Todas as séries registradas agora serão perdidas.',
      confirmLabel: 'Descartar', danger: true,
    });
    if (!ok) return;
    persist.cancel(); clearDraft(); stopRest();
    toast('Treino descartado.');
    navigate('/');
  }

  async function finish() {
    persist.flush();
    const items = activeItems().map((it) => ({
      exerciseId: it.exerciseId, name: it.name, group: it.group, note: it.note, planned: it.planned,
      sets: it.sets.filter((s) => s.done).map((s) => ({ weight: Number(s.weight), reps: Number(s.reps) })),
    })).filter((it) => it.sets.length);

    if (!items.length) {
      const ok = await confirmDialog({
        title: 'Nenhuma série registrada', message: 'Não há nada para salvar. Descartar este treino?',
        confirmLabel: 'Descartar', danger: true,
      });
      if (ok) { clearDraft(); stopRest(); navigate('/'); }
      return;
    }
    const { total, done } = totals();
    const ok = await confirmDialog({
      title: 'Finalizar treino?',
      message: done < total
        ? `${done} séries registradas. As ${total - done} não feitas serão ignoradas.`
        : `${done} séries registradas.`,
      confirmLabel: 'Finalizar',
    });
    if (!ok) return;
    const session = addSession({
      date: draft.date, dayId: draft.dayId, title: draft.title,
      startedAt: draft.startedAt, endedAt: Date.now(), note: draft.note, items,
    });
    persist.cancel(); clearDraft(); stopRest();
    toast('Treino salvo.');
    navigate(`/historico/${session.id}`);
  }

  // ───── Montagem ─────
  const list = h('div', { class: 'stack' });
  const root = h('div', { class: 'view' },
    pageHead(day.title, { subtitle: `${day.name} · rascunho salvo automaticamente`, back: '#/' }),
    h('div', { class: 'stack' }, progressText, progressBar),
    list,
    h('div', { class: 'field' },
      h('label', { for: 'sess-note' }, 'Observações do treino'),
      h('textarea', {
        id: 'sess-note', class: 'input', maxlength: '500', value: draft.note,
        placeholder: 'Opcional: sono, energia, dores…',
        onInput: (e) => { draft.note = e.target.value; persist(); },
      })),
    h('button', { type: 'button', class: 'btn primary block', onClick: finish }, icon('check'), 'Finalizar treino'),
    h('button', { type: 'button', class: 'btn danger block', onClick: discard }, 'Descartar treino'));

  paintAll();
  updateProgress();

  // Tela ligada durante o treino (opcional em Ajustes).
  let lock = null;
  const acquire = async () => {
    if (!settings.keepAwake || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { lock = null; });
    } catch { /* sem suporte/permissão: segue normalmente */ }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') { if (!lock) acquire(); } else persist.flush();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', persist.flush);
  acquire();

  return {
    el: root,
    title: day.title,
    live: false, // não redesenhar por mudanças remotas durante o treino
    destroy() {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', persist.flush);
      persist.flush();
      lock?.release?.();
    },
  };
}
