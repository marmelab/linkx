import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useOutletContext } from "react-router";
import {
  fetchQualificationState,
  fetchQueue,
  fetchWaves,
  runCron,
} from "./api";
import type { CronFunction, EdgeReply, QualificationState } from "./api";
import { summarizeQueue } from "./queue";
import type { QueueRow } from "./queue";
import { formatParisDate } from "./schedule";
import type { WaveRow } from "./types";
import type { QueryState } from "./AsyncPanel";
import { TOURNAMENT_PATHS } from "./routes";
import { useSession } from "./session";
import type { TournamentContext } from "./TournamentLayout";

/**
 * Ce que chaque commande fait, dit en clair. Les noms de code du serveur —
 * `scheduler`, `referee-tick` — ne parlent qu'à qui l'a lu ; un administrateur a
 * besoin de savoir ce qu'il déclenche.
 *
 * Deux commandes appellent le même ordonnanceur : la première le réveille comme
 * le cron, la seconde lui demande d'ouvrir une vague sans attendre le jeudi.
 * C'est tout ce que `force` a jamais fait, et cela se dit mieux par un bouton
 * que par une case à cocher nommée d'après le serveur.
 */
const CRON_ACTIONS: ReadonlyArray<{
  id: string;
  name: CronFunction;
  force: boolean;
  title: string;
  button: string;
  description: string;
}> = [
  {
    id: "ordonnancer",
    name: "scheduler",
    force: false,
    title: "Faire avancer le tournoi",
    button: "Rejouer le réveil du cron",
    description:
      "Exactement ce que fait le réveil automatique, une minute plus tôt : qualifie les IA nouvellement déclarées, remet en file les parties immobiles, et clôt la vague ouverte en calculant le classement Elo dès que toutes ses parties sont jouées. N’ouvre aucune vague en dehors du jeudi : c’est ce qui le distingue de la commande suivante.",
  },
  {
    id: "vague-maintenant",
    name: "scheduler",
    force: true,
    title: "Lancer une vague maintenant",
    button: "Ouvrir une vague",
    description:
      "Ouvre une vague immédiatement, sans attendre le jeudi, et l’appareille. Elle se joue et se classe comme les autres, et dure douze heures à compter de son ouverture. Refusé tant qu’une vague est encore en cours : il n’y en a jamais deux à la fois.",
  },
  {
    id: "arbitrer",
    name: "referee-tick",
    force: false,
    title: "Arbitrer",
    button: "Jouer un tour d’arbitrage",
    description:
      "Fait avancer les parties en attente : à chacune, appelle l’IA au trait et applique son coup. Un tour s’arrête sur son budget de temps, sans forcément terminer les parties — le relancer jusqu’à ce qu’elles le soient.",
  },
];

/** « 12 min », « 2 h 05 » : une durée d'attente se lit sans secondes. */
function formatIdle(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "moins d’une minute";
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  return `${heures} h ${String(minutes % 60).padStart(2, "0")}`;
}

/**
 * Une qualification jouée mais pas encore validée se dit à part : c'est le seul
 * cas où l'IA paraît bloquée alors qu'il ne manque qu'un réveil.
 */
function QualificationLine({ state }: { state: QualificationState }) {
  const { awaiting, played } = state;
  if (awaiting === 0) return <>Aucune IA n’attend sa qualification.</>;

  const pending = awaiting - played;
  const parts: string[] = [];
  if (played > 0) {
    parts.push(
      played === 1
        ? "1 qualification est jouée et n’attend qu’un réveil pour être validée"
        : `${played} qualifications sont jouées et n’attendent qu’un réveil pour être validées`,
    );
  }
  if (pending > 0) {
    parts.push(
      pending === 1
        ? "1 qualification reste à ouvrir"
        : `${pending} qualifications restent à ouvrir`,
    );
  }
  return <>{parts.join(", ")}.</>;
}

/**
 * Les trois états d'une vague, dits en clair.
 *
 * `planifiee` **n'est pas** close : c'est l'instant où ses centaines de parties
 * se créent, juste après le clic sur « Ouvrir une vague » — l'annoncer close
 * laissait croire à une commande sans effet et invitait à la relancer. Et rien
 * ne se dit ici de « une vague par jeudi » : depuis `plateforme_tournoi_vague_a_
 * la_demande`, le bouton voisin en ouvre une n'importe quel jour.
 */
const WAVE_STATUS_LABELS: Partial<Record<WaveRow["statut"], string>> = {
  planifiee: "ouverte, appariements en cours de création.",
  en_cours: "en cours.",
  terminee: "close et classée.",
};

type QueuePayload = {
  rows: QueueRow[];
  waves: WaveRow[];
  qualifications: QualificationState;
};

/**
 * L'état de la file, avant les commandes : ce qui attend, de quelle nature, et
 * depuis combien de temps rien n'a bougé. C'est ce qui dit s'il faut relancer
 * un tour, et si l'immobilité vient d'une file vide ou d'un blocage.
 */
function QueueState({ state }: { state: QueryState<QueuePayload> }) {
  if (state.isError && !state.isFetching) {
    return (
      <div className="tournament-note" role="alert">
        <p>L’état de la file n’a pas pu être lu.</p>
        {state.error && (
          <p className="tournament-error">
            {state.error.message || "Erreur inconnue."}
          </p>
        )}
        <button
          type="button"
          className="secondary-button secondary-button--small"
          onClick={state.refetch}
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (state.data === undefined) {
    return (
      <p className="tournament-note" aria-live="polite">
        Lecture de la file…
      </p>
    );
  }

  const queue = summarizeQueue(state.data.rows, Date.now());
  const [wave] = state.data.waves;
  const natures = [
    queue.wave > 0 ? `${queue.wave} de vague` : null,
    queue.qualifications > 0 ? `${queue.qualifications} de qualification` : null,
  ].filter((part) => part !== null);

  return (
    <div className="admin-queue">
      {queue.total === 0 ? (
        <p className="bot-card__summary">
          <strong>File vide.</strong> Aucune partie n’attend d’être arbitrée.
        </p>
      ) : (
        <>
          <p className="bot-card__summary">
            <strong>
              {queue.total} partie{queue.total > 1 ? "s" : ""} en attente
            </strong>{" "}
            ({natures.join(", ")}) : {queue.running} entamée
            {queue.running > 1 ? "s" : ""}, {queue.waiting} pas encore
            commencée{queue.waiting > 1 ? "s" : ""}.
          </p>
          {queue.oldestIdleMs !== null && (
            <p className="bot-card__summary">
              La plus ancienne n’a pas bougé depuis{" "}
              {formatIdle(queue.oldestIdleMs)}. Au-delà de quelques minutes,
              l’ordonnanceur la remet en file de lui-même.
            </p>
          )}
        </>
      )}
      {/* Ce que l'ordonnanceur a devant lui. Sans ces deux lignes, un réveil
          qui ne fait rien passe pour un réveil en panne. */}
      <p className="bot-card__summary">
        <QualificationLine state={state.data.qualifications} />
      </p>
      <p className="bot-card__summary">
        {wave === undefined
          ? "Aucune vague n’a encore été ouverte."
          : `Vague du ${formatParisDate(Date.parse(wave.debut))} : ${
              WAVE_STATUS_LABELS[wave.statut] ?? wave.statut
            }`}
      </p>
    </div>
  );
}


/**
 * Déclenchement à la main des deux réveils de cron, pour les seuls
 * administrateurs — la détection est une lecture de `administrateurs`, dont la
 * politique ne rend une ligne qu'à un membre. Un utilisateur ordinaire ne voit
 * rien de ce bloc.
 *
 * Le compte rendu est celui du cron, rendu tel quel : c'est exactement ce qu'un
 * administrateur vient chercher, et le résumer en perdrait la substance.
 */
function CronPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<{
    id: string;
    reply: EdgeReply;
  } | null>(null);

  const queue = useQuery({
    queryKey: ["file-attente"],
    queryFn: async (): Promise<QueuePayload> => {
      const [rows, waves, qualifications] = await Promise.all([
        fetchQueue(),
        fetchWaves(1),
        fetchQualificationState(),
      ]);
      return { rows, waves, qualifications };
    },
  });

  const run = async (action: (typeof CRON_ACTIONS)[number]) => {
    setBusy(action.id);
    setReport(null);
    try {
      setReport({ id: action.id, reply: await runCron(action.name, action.force) });
      // Le décompte a bougé : un tour d'arbitrage termine des parties, et
      // l'ordonnanceur en crée.
      void queue.refetch();
    } catch (error) {
      setReport({
        id: action.id,
        reply: {
          ok: false,
          message: error instanceof Error ? error.message : "Appel impossible.",
        },
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="admin-panel">
      <h2 className="overline tournament-subtitle">File d’attente</h2>
      <QueueState state={queue} />

      <ul className="bot-list">
        {CRON_ACTIONS.map((action) => (
          <li key={action.id} className="bot-card">
            <p className="bot-card__head">
              <strong>{action.title}</strong>
            </p>
            <p className="bot-card__summary">{action.description}</p>
            <p className="bot-card__actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => run(action)}
                disabled={busy !== null}
              >
                {busy === action.id ? "En cours…" : action.button}
              </button>
            </p>
            {/* Le compte rendu se pose sous le bouton qui l'a produit. En pied
                d'écran, il tombait hors du champ visible : on cliquait, et rien
                ne semblait se passer. */}
            {report?.id === action.id && (
              <>
                <p className="tournament-hint">
                  Réponse de la fonction, telle que le cron la reçoit :
                </p>
                <pre
                  className="admin-panel__report"
                  role={report.reply.ok ? "status" : "alert"}
                >
                  {JSON.stringify(report.reply, null, 2)}
                </pre>
              </>
            )}
          </li>
        ))}
      </ul>

    </section>
  );
}

/**
 * Écran réservé aux administrateurs, atteint par une entrée de navigation qui
 * n'existe que pour eux.
 *
 * La route n'est pas un secret — le fragment se tape —, mais elle ne montre
 * rien de plus qu'au premier venu : sans le droit, elle renvoie au classement
 * plutôt que d'annoncer qu'un écran existe ici. La barrière qui compte est de
 * toute façon côté serveur, les deux fonctions vérifiant elles-mêmes l'appelant.
 */
export function AdminScreen() {
  const { session, ready } = useSession();
  // Le droit est déjà établi par la mise en page, qui s'en sert pour son
  // entrée de navigation : le redemander ici doublerait la requête.
  const { admin } = useOutletContext<TournamentContext>();

  // **Avant** de regarder le droit : sans session, sa lecture reste suspendue
  // pour toujours — c'est ce que `pending()` veut dire — et l'écran afficherait
  // « Chargement… » sans fin. C'est le cas d'une déconnexion faite d'ici.
  if (ready && !session) {
    return <Navigate to={TOURNAMENT_PATHS.login} replace />;
  }

  // Une panne se **dit**, elle ne renvoie pas au classement : une lecture sans
  // réponse et un refus se confondraient, et un administrateur croirait avoir
  // perdu ses droits — exactement ce que `api.ts:isAdministrator` refuse de
  // faire en propageant sa panne. On reste donc sur place, avec de quoi
  // réessayer.
  if (admin.isError && !admin.isFetching) {
    return (
      <div className="tournament-note" role="alert">
        <p>Vos droits n’ont pas pu être vérifiés.</p>
        {admin.error && (
          <p className="tournament-error">
            {admin.error.message || "Erreur inconnue."}
          </p>
        )}
        <button
          type="button"
          className="secondary-button secondary-button--small"
          onClick={() => void admin.refetch()}
        >
          Réessayer
        </button>
      </div>
    );
  }
  // Une relecture garde la valeur précédente : un administrateur déjà reconnu ne
  // repasse pas par l'écran de chargement à chaque revalidation.
  if (admin.data === undefined) {
    return (
      <p className="tournament-note" aria-live="polite">
        Chargement…
      </p>
    );
  }
  if (!admin.data) {
    return <Navigate to={TOURNAMENT_PATHS.leaderboard} replace />;
  }

  return (
    <>
      <h1 className="tournament-title">Administration</h1>
      <p className="tournament-lede">
        Ces deux traitements tournent d’eux-mêmes, réveillés chaque minute. Les
        lancer ici ne fait qu’anticiper un réveil : rien qu’ils ne feraient
        seuls, à l’heure dite.
      </p>
      <CronPanel />
    </>
  );
}
