/**
 * FORJA — Tela "Treino" (início): treino do dia, semana e treino em andamento.
 */
import { h, icon, fmtDateLong, fmtDateShort, weekStartISO, isoDate, parseISODate } from '../utils.js';
import { getPlan, getSessions, getExercise, loadDraft, clearDraft } from '../store.js';
import { GROUPS } from '../data/library.js';
import { pageHead, confirmDialog, toast } from '../ui.js';

/** Resumo dos grupos musculares do dia (ex.: "Peito, Costas"). */
function groupsOf(day) {
  const set = new Set();
  day.items.forEach((it) => {
    const g = getExercise(it.exerciseId)?.group;
    if (g) set.add(GROUPS[g]);
  });
  return [...set].join(', ');
}

export function render({ rerender }) {
  const plan = getPlan();
  const sessions = getSessions();
  const draft = loadDraft();
  const todayISO = isoDate();
  const dow = new Date().getDay();
  const todayDay = plan.days.find((d) => d.weekday === dow);

  const root = h('div', { class: 'view' },
    pageHead('Treino', { subtitle: fmtDateLong(todayISO) }));

  // Treino em andamento (rascunho salvo automaticamente)
  if (draft) {
    root.append(h('div', { class: 'banner accent', role: 'region', 'aria-label': 'Treino em andamento' },
      h('div', {}, h('strong', {}, 'Treino em andamento'), h('span', { class: 'muted' }, `${draft.title} · iniciado em ${fmtDateShort(draft.date)}`)),
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn primary', href: `#/treino/${draft.dayId}` }, 'Continuar'),
        h('button', {
          type: 'button', class: 'btn danger',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Descartar treino em andamento?',
              message: 'As séries registradas neste treino serão perdidas.',
              confirmLabel: 'Descartar', danger: true,
            });
            if (ok) { clearDraft(); toast('Treino descartado.'); rerender(); }
          },
        }, 'Descartar'))));
  }

  // Cartão do dia
  if (todayDay) {
    const doneToday = sessions.some((s) => s.date === todayISO && s.dayId === todayDay.id);
    root.append(h('section', { class: 'card hero', 'aria-labelledby': 'hoje-titulo' },
      h('div', { class: 'row wrap' },
        h('span', { class: 'tag accent' }, 'Hoje'),
        doneToday ? h('span', { class: 'tag ok' }, 'Concluído') : null),
      h('h2', { id: 'hoje-titulo' }, todayDay.title),
      h('p', { class: 'muted' }, `${todayDay.items.length} exercícios · ${groupsOf(todayDay)}`),
      h('a', { class: 'btn primary block', href: `#/treino/${todayDay.id}` },
        icon('dumbbell'), draft?.dayId === todayDay.id ? 'Continuar treino' : doneToday ? 'Treinar novamente' : 'Iniciar treino')));
  } else {
    const next = plan.days.find((d) => d.weekday > dow) ?? plan.days[0];
    root.append(h('section', { class: 'card' },
      h('h2', {}, 'Hoje é dia de descanso'),
      h('p', { class: 'muted' }, 'A recuperação também faz parte da hipertrofia.'),
      next ? h('p', {}, 'Próximo treino: ', h('strong', {}, `${next.name} — ${next.title}`)) : null));
  }

  // Progresso semanal
  const weekStart = weekStartISO();
  const doneDays = new Set(sessions.filter((s) => s.date >= weekStart).map((s) => s.dayId));
  const planned = plan.days.length;
  const doneCount = plan.days.filter((d) => doneDays.has(d.id)).length;
  const monday = parseISODate(weekStart);
  const weekDayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const weekDayNumbers = [1, 2, 3, 4, 5, 6, 0];
  const weekStrip = h('div', { class: 'week-strip', role: 'group', 'aria-label': 'Treinos desta semana' });
  weekDayNumbers.forEach((weekday, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    const dateKey = isoDate(date);
    const day = plan.days.find((item) => item.weekday === weekday);
    const completed = sessions.some((session) => session.date === dateKey);
    const isToday = dateKey === todayISO;
    const state = completed ? 'Treino concluído' : day ? 'Treino planejado' : 'Descanso';
    const content = [
      h('span', { class: 'week-day-label' }, weekDayLabels[index]),
      h('span', { class: 'week-day-letter', 'aria-hidden': 'true' }, completed ? '✓' : day ? day.name.slice(0, 1) : '·'),
      h('span', { class: 'week-day-date' }, String(date.getDate()).padStart(2, '0')),
    ];
    weekStrip.append(day
      ? h('a', {
        class: `week-day${completed ? ' complete' : ''}${isToday ? ' today' : ''}`,
        href: `#/treino/${day.id}`,
        'aria-label': `${weekDayLabels[index]} ${date.getDate()}, ${day.title}, ${state}${isToday ? ', hoje' : ''}`,
        'aria-current': isToday ? 'date' : null,
      }, ...content)
      : h('div', {
        class: `week-day rest${isToday ? ' today' : ''}`,
        'aria-label': `${weekDayLabels[index]} ${date.getDate()}, descanso${isToday ? ', hoje' : ''}`,
      }, ...content));
  });
  root.append(h('section', { class: 'card', 'aria-labelledby': 'semana-titulo' },
    h('div', { class: 'row between' },
      h('h2', { id: 'semana-titulo' }, 'Seu ritmo'),
      h('span', { class: 'tag accent' }, `${doneCount}/${planned} treinos`)),
    h('p', { class: 'muted small' }, 'Toque em um dia para abrir o treino planejado.'),
    h('div', {
      class: 'progress', role: 'progressbar', 'aria-label': 'Treinos concluídos na semana',
      'aria-valuemin': '0', 'aria-valuemax': String(planned), 'aria-valuenow': String(doneCount),
    }, h('span', { style: { '--pct': `${planned ? (doneCount / planned) * 100 : 0}%` } })),
    weekStrip));

  // Lista da semana
  root.append(h('div', { class: 'section-title' }, h('h2', {}, 'Divisão semanal')));
  const list = h('ul', { class: 'list' });
  for (const d of plan.days) {
    const last = sessions.find((s) => s.dayId === d.id);
    list.append(h('li', {},
      h('a', { class: 'list-item', href: `#/treino/${d.id}` },
        h('span', { class: `day-badge${d.weekday === dow ? ' today' : ''}`, 'aria-hidden': 'true' }, d.name.slice(0, 3)),
        h('span', { class: 'grow' },
          h('span', { class: 'title' }, `${d.name} — ${d.title}`), h('br'),
          h('span', { class: 'meta' }, `${d.items.length} exercícios · ${last ? `último: ${fmtDateShort(last.date)}` : 'ainda não registrado'}`)))));
  }
  root.append(list);

  root.append(h('a', { class: 'btn', href: `#/ficha/${(todayDay ?? plan.days[0]).id}` }, icon('edit'), 'Editar ficha'));

  return { el: root, title: 'Treino' };
}
