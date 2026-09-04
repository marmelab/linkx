import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { AsyncPanel } from "./AsyncPanel";
import { CopyButton } from "./CopyButton";
import {
  fetchBotHistory,
  fetchMyBots,
  fetchMyGames,
  isAdministrator,
  probeBot,
  registerBot,
  runCron,
  setBotStatus,
} from "./api";
import type { CronFunction, EdgeReply, ProbeReply, RegisterReply } from "./api";
import { summarizeLastWave } from "./botSummary";
import type { WaveSummary } from "./botSummary";
import { toMyGames } from "./games";
import { formatGap } from "./ranking";
import { STATUS_LABELS } from "./outcomes";
import { TOURNAMENT_PATHS } from "./routes";
import { PROTOCOL_URL } from "./protocol";
import { useSession } from "./session";
import { PENDING, useAsync } from "./useAsync";
import type { BotRow } from "./types";

type Payload = {
  bots: BotRow[];
  summaries: Map<string, WaveSummary | null>;
};

async function loadMyBots(): Promise<Payload> {
  const bots = await fetchMyBots();
  const ids = bots.map((bot) => bot.id);
  const [history, rows] = await Promise.all([
    fetchBotHistory(ids),
    ids.length === 0 ? Promise.resolve([]) : fetchMyGames(),
  ]);
  const games = toMyGames(rows, ids);
  return {
    bots,
    summaries: new Map(
      bots.map((bot) => [bot.id, summarizeLastWave(bot.id, history, games)]),
    ),
  };
}

function Summary({ summary }: { summary: WaveSummary | null }) {
  if (!summary) {
    return (
      <p className="bot-card__summary">
        Aucune vague jouée pour l’instant : le bilan paraîtra après la première.
      </p>
    );
  }
  return (
    <p className="bot-card__summary">
      Dernière vague : {summary.elo} points d’Elo ({formatGap(summary.gap)}),{" "}
      {summary.wins} gagnées, {summary.draws} nulles, {summary.losses} perdues,
      dont {summary.technical} sur faute technique.
    </p>
  );
}

function BotCard({
  bot,
  summary,
  onChanged,
}: {
  bot: BotRow;
  summary: WaveSummary | null;
  onChanged: () => void;
}) {
  const [probe, setProbe] = useState<ProbeReply | null>(null);
  const [busy, setBusy] = useState<"probe" | "status" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Un retrait ne se défait pas, et le bouton voisine avec « Tester » : il
  // demande donc confirmation, sur place, avant de partir.
  const [confirming, setConfirming] = useState(false);

  const runProbe = async () => {
    setBusy("probe");
    setProbe(null);
    setFailure(null);
    try {
      setProbe(await probeBot(bot.id));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Sonde impossible.");
    } finally {
      setBusy(null);
    }
  };

  const changeStatus = async (status: "retiree" | "en_attente") => {
    setBusy("status");
    setFailure(null);
    setConfirming(false);
    try {
      const reply = await setBotStatus(bot.id, status);
      if (!reply.ok) {
        setFailure(reply.message ?? "Le service a refusé la demande.");
      } else {
        onChanged();
      }
    } catch (error) {
      setFailure(
        error instanceof Error ? error.message : "Demande impossible.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="bot-card">
      <p className="bot-card__head">
        <strong>{bot.nom}</strong>
        <span className={`badge badge--${bot.statut}`}>
          {STATUS_LABELS[bot.statut]}
        </span>
      </p>
      <p className="bot-card__address">{bot.adresse_service}</p>
      {bot.ia_maison && (
        <p className="bot-card__summary">
          IA de la maison : elle joue les vagues avec un budget de réflexion
          plus court que dans le jeu, borné par le délai de six secondes.
        </p>
      )}
      <Summary summary={summary} />

      <p className="bot-card__actions">
        <button
          type="button"
          className="secondary-button secondary-button--small"
          onClick={runProbe}
          disabled={busy !== null}
        >
          {busy === "probe" ? "Sonde en cours…" : "Tester"}
        </button>
        <Link
          className="secondary-button secondary-button--small"
          to={`${TOURNAMENT_PATHS.games}?ia=${bot.id}`}
        >
          Voir ses parties
        </Link>
        {/* Une IA retirée ne revient pas : ne rien lui proposer vaut mieux
            qu'un bouton dont le service refusera la demande. */}
        {bot.statut === "sommeil" ? (
          <button
            type="button"
            className="secondary-button secondary-button--small"
            onClick={() => changeStatus("en_attente")}
            disabled={busy !== null}
          >
            Réactiver
          </button>
        ) : bot.statut === "retiree" ? null : (
          <button
            type="button"
            className="secondary-button secondary-button--small"
            onClick={() => setConfirming(true)}
            disabled={busy !== null || confirming}
          >
            Retirer
          </button>
        )}
      </p>

      {confirming && (
        <div className="bot-card__confirm">
          {/* Le bouton « Retirer » se désactive en s'ouvrant : la question est
              donc annoncée, et le premier bouton de la réponse prend le focus
              qu'il vient de perdre. */}
          <p role="alert">
            Retirer <strong>{bot.nom}</strong> ? Elle cesse de jouer les vagues,
            et une IA retirée ne revient pas.
          </p>
          <p className="bot-card__actions">
            <button
              type="button"
              className="secondary-button secondary-button--small"
              autoFocus
              onClick={() => changeStatus("retiree")}
              disabled={busy !== null}
            >
              Confirmer le retrait
            </button>
            <button
              type="button"
              className="secondary-button secondary-button--small"
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
            >
              Annuler
            </button>
          </p>
        </div>
      )}

      {probe && (
        <>
          <p
            className={probe.ok ? "tournament-note" : "tournament-error"}
            role={probe.ok ? "status" : "alert"}
          >
            {probe.message ?? (probe.ok ? "OK." : "Échec.")}
          </p>
          {/* L'échange complet, et non le seul verdict : c'est la seule façon
              de distinguer une signature refusée d'une route absente. */}
          {probe.request && (
            <pre className="probe-report">
              {[
                `→ POST ${probe.url ?? bot.adresse_service}`,
                ...Object.entries(probe.headers ?? {}).map(
                  ([nom, valeur]) => `${nom}: ${valeur}`,
                ),
                "",
                probe.request,
                "",
                `← HTTP ${probe.status ?? "aucune réponse"}`,
                probe.snippet ? probe.snippet : "  (corps vide)",
                // Le motif ne s'affiche que s'il dit autre chose que le code
                // déjà rendu juste au-dessus.
                probe.detail && probe.detail !== `code HTTP ${probe.status}`
                  ? `  ${probe.detail}`
                  : null,
              ]
                .filter((ligne) => ligne !== null)
                .join("\n")}
            </pre>
          )}
        </>
      )}
      {failure && (
        <p className="tournament-error" role="alert">
          {failure}
        </p>
      )}
    </li>
  );
}

const CRON_LABELS: Record<CronFunction, string> = {
  scheduler: "Lancer l’ordonnanceur",
  "referee-tick": "Faire jouer un tour d’arbitrage",
};

/**
 * Déclenchement à la main des deux réveils de cron, pour les seuls
 * administrateurs — la détection est une lecture de `administrateurs`, dont la
 * politique ne rend une ligne qu'à un membre. Un utilisateur ordinaire ne voit
 * rien de ce bloc.
 *
 * Le compte rendu est celui du cron, rendu tel quel : c'est exactement ce qu'un
 * administrateur vient chercher, et le résumer en perdrait la substance.
 */
function AdminPanel() {
  const [busy, setBusy] = useState<CronFunction | null>(null);
  const [force, setForce] = useState(false);
  const [report, setReport] = useState<{
    name: CronFunction;
    reply: EdgeReply;
  } | null>(null);

  const run = async (name: CronFunction) => {
    setBusy(name);
    setReport(null);
    try {
      setReport({ name, reply: await runCron(name, force) });
    } catch (error) {
      setReport({
        name,
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
      <h2 className="overline tournament-subtitle">Administration</h2>
      <p className="tournament-hint">
        Les deux fonctions que <code>pg_cron</code> réveille chaque minute. Le
        compte rendu est le même que le sien.
      </p>
      <p className="bot-card__actions">
        {(Object.keys(CRON_LABELS) as CronFunction[]).map((name) => (
          <button
            key={name}
            type="button"
            className="secondary-button secondary-button--small"
            onClick={() => run(name)}
            disabled={busy !== null}
          >
            {busy === name ? "En cours…" : CRON_LABELS[name]}
          </button>
        ))}
      </p>
      <p className="admin-panel__force">
        <label>
          <input
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
            disabled={busy !== null}
          />{" "}
          Hors de la fenêtre du jeudi (<code>force</code>)
        </label>
      </p>
      {report && (
        <pre
          className="admin-panel__report"
          role={report.reply.ok ? "status" : "alert"}
        >
          {CRON_LABELS[report.name]}
          {"\n"}
          {JSON.stringify(report.reply, null, 2)}
        </pre>
      )}
    </section>
  );
}

function DeclareForm({
  onDeclared,
  onClose,
}: {
  onDeclared: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<{
    name?: string;
    url?: string;
    general?: string;
  }>({});
  const [sending, setSending] = useState(false);
  const [secret, setSecret] = useState<RegisterReply | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    setErrors({});
    try {
      const reply = await registerBot(name.trim(), url.trim());
      if (!reply.ok) {
        // Un refus se rend **sous le champ en cause** : un message général
        // laisserait chercher lequel des deux est en faute.
        const message = reply.message ?? "Déclaration refusée.";
        if (reply.field === "name") setErrors({ name: message });
        else if (reply.field === "url") setErrors({ url: message });
        else setErrors({ general: message });
        return;
      }
      setSecret(reply);
      setName("");
      setUrl("");
      onDeclared();
    } catch (error) {
      setErrors({
        general:
          error instanceof Error ? error.message : "Déclaration impossible.",
      });
    } finally {
      setSending(false);
    }
  };

  // Le secret **remplace** le formulaire au lieu de s'ajouter à lui : il n'est
  // montré qu'une fois, et des champs vides à côté laisseraient croire qu'il
  // reste quelque chose à saisir.
  if (secret?.secret) {
    return (
      <>
        <h2 className="overline tournament-subtitle">IA déclarée</h2>
        <div className="secret-panel" role="alert">
          <p>
            <strong>
              {secret.warning ??
                "Ce secret de signature n’est affiché qu’une seule fois : conservez-le maintenant, il ne sera jamais réaffiché."}
            </strong>
          </p>
          <p className="secret-panel__value">
            <code>{secret.secret}</code>
            <CopyButton
              value={secret.secret}
              label="Copier le secret"
              prompt="Copiez ce secret : il ne sera jamais réaffiché."
            />
          </p>
          {secret.message && <p>{secret.message}</p>}
        </div>
        <button type="button" className="primary-button" onClick={onClose}>
          Fermer
        </button>
      </>
    );
  }

  return (
    <>
      <h2 className="overline tournament-subtitle">Déclarer une IA</h2>
      <p className="tournament-note">
        Votre service doit savoir jouer à Linkx.{" "}
        <a href={PROTOCOL_URL} target="_blank" rel="noreferrer">
          Lire la spécification
        </a>
        .
      </p>
      <form className="tournament-form" onSubmit={submit}>
        <div className="tournament-field">
          <label htmlFor="ia-nom">Nom de l’IA</label>
          <input
            id="ia-nom"
            name="ia-nom"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="LinkxMaster"
            aria-describedby={errors.name ? "ia-nom-erreur" : undefined}
          />
          <small className="tournament-hint">
            Il sera public : c’est le seul élément visible au classement.
          </small>
          {errors.name && (
            <p className="tournament-error" id="ia-nom-erreur">
              {errors.name}
            </p>
          )}
        </div>
        <div className="tournament-field">
          <label htmlFor="ia-adresse">Adresse du service</label>
          <input
            id="ia-adresse"
            name="ia-adresse"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://exemple.fr/linkx"
            aria-describedby={errors.url ? "ia-adresse-erreur" : undefined}
          />
          <small className="tournament-hint">
            <code>https</code> obligatoire. N'apparaît pas dans le classement
            public.
          </small>
          {errors.url && (
            <p className="tournament-error" id="ia-adresse-erreur">
              {errors.url}
            </p>
          )}
        </div>
        <div className="tournament-form__actions">
          <button type="submit" className="primary-button" disabled={sending}>
            {sending ? "Déclaration…" : "Déclarer"}
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            Annuler
          </button>
        </div>
        {errors.general && (
          <p className="tournament-error" role="alert">
            {errors.general}
          </p>
        )}
      </form>
    </>
  );
}

export function MyBotsScreen() {
  const { session, ready } = useSession();
  // Rien n'est lu avant que la session ait répondu : une lecture à vide
  // annoncerait « aucune IA » à un auteur qui en a déclaré.
  const state = useAsync<Payload>(
    () => (session ? loadMyBots() : PENDING),
    [ready, session?.user.id],
  );
  // Lecture séparée de la liste des IA : elle ne concerne qu'une poignée de
  // comptes, et une panne de son côté ne doit pas priver l'auteur de ses IA.
  const admin = useAsync<boolean>(
    () => (session ? isAdministrator() : PENDING),
    [ready, session?.user.id],
  );
  // Le formulaire est **appelé**, jamais posé d'office : l'écran s'ouvre sur ce
  // que l'auteur a déjà, pas sur ce qu'il pourrait ajouter.
  const [declaring, setDeclaring] = useState(false);

  if (ready && !session)
    return <Navigate to={TOURNAMENT_PATHS.login} replace />;

  return (
    <>
      <h1 className="tournament-title">Mes IA</h1>
      <p className="tournament-lede">
        Une IA est un service qui répond un coup. Déclarez la vôtre, testez-la,
        puis laissez-la jouer les vagues du jeudi.
      </p>

      <AsyncPanel state={state}>
        {(payload) =>
          payload.bots.length === 0 ? (
            <p className="tournament-note">
              Vous n’avez encore déclaré aucune IA. En déclarer une demande deux
              choses : un nom et une adresse.
            </p>
          ) : (
            <ul className="bot-list">
              {payload.bots.map((bot) => (
                <BotCard
                  key={bot.id}
                  bot={bot}
                  summary={payload.summaries.get(bot.id) ?? null}
                  onChanged={state.reload}
                />
              ))}
            </ul>
          )
        }
      </AsyncPanel>

      {/* Hors du panneau asynchrone, et c'est **indispensable** : la relecture
          de la liste qui suit une déclaration ne doit pas démonter le
          formulaire, qui porte le secret affiché une seule fois. */}
      {declaring ? (
        <DeclareForm
          onDeclared={state.reload}
          onClose={() => setDeclaring(false)}
        />
      ) : (
        <button
          type="button"
          className="primary-button"
          onClick={() => setDeclaring(true)}
        >
          Ajouter une IA
        </button>
      )}

      {/* Une vérification qui n'a pas abouti se dit, sans quoi un administrateur
          croirait avoir perdu ses droits. La phrase reste muette sur qui en a :
          elle ne parle que de la lecture. */}
      {admin.status === "error" && (
        <p className="tournament-note" role="alert">
          Vos droits n’ont pas pu être vérifiés.{" "}
          <button
            type="button"
            className="secondary-button secondary-button--small"
            onClick={admin.reload}
          >
            Réessayer
          </button>
        </p>
      )}
      {admin.data === true && <AdminPanel />}
    </>
  );
}
