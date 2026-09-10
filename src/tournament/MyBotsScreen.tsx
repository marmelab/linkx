import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate } from "react-router";
import { AsyncPanel } from "./AsyncPanel";
import { CopyButton } from "./CopyButton";
import {
  fetchBotHistory,
  fetchGameRows,
  fetchMyBots,
  probeBot,
  registerBot,
  updateBot,
} from "./api";
import type { BotChange, ProbeReply, RegisterReply } from "./api";
import { lastWaveRow, summarizeLastWave } from "./botSummary";
import type { WaveSummary } from "./botSummary";
import { toMyGames } from "./games";
import { formatGap } from "./ranking";
import { STATUS_LABELS } from "./outcomes";
import { TOURNAMENT_PATHS } from "./routes";
import { PROTOCOL_URL } from "./protocol";
import { useSession } from "./session";
import { pending, useAsync } from "./useAsync";
import type { BotRow } from "./types";

type Payload = {
  bots: BotRow[];
  summaries: Map<string, WaveSummary | null>;
};

/**
 * Les IA retirées passent en dernier : elles ne jouent plus, et l'auteur vient
 * d'abord voir celles qui vivent. Une IA en sommeil reste parmi elles — elle se
 * réactive, quand un retrait est définitif.
 *
 * Le tri est stable, si bien que l'ordre de déclaration rendu par la requête est
 * conservé à l'intérieur de chaque groupe.
 */
function withdrawnLast(bots: readonly BotRow[]): BotRow[] {
  const withdrawn = (bot: BotRow) => (bot.statut === "retiree" ? 1 : 0);
  return [...bots].sort((a, b) => withdrawn(a) - withdrawn(b));
}

/**
 * Seules les parties **des dernières vagues** sont lues, et sans nommer
 * personne : le bilan ne compte que les défaites techniques de la vague que
 * `summarizeLastWave` retient, et n'affiche aucun adversaire. Tout charger — les
 * quatre cents dernières parties, plus une requête pour résoudre huit cents
 * noms jamais lus — coûtait deux lectures lourdes à chaque affichage et à chaque
 * relecture, retrait ou déclaration comprise. Le décompte y gagne au passage
 * d'être juste au-delà de cette borne.
 *
 * Les IA d'un même auteur partagent presque toujours leur dernière vague : c'est
 * donc une requête, bornée par le plafond de dix IA par compte.
 */
async function loadMyBots(owner: string): Promise<Payload> {
  const bots = withdrawnLast(await fetchMyBots(owner));
  const ids = bots.map((bot) => bot.id);
  const history = await fetchBotHistory(ids);

  const lastWaves = [
    ...new Set(
      bots
        .map((bot) => lastWaveRow(bot.id, history)?.vague_id)
        .filter((waveId) => waveId !== undefined),
    ),
  ];
  const rows = (
    await Promise.all(
      lastWaves.map((waveId) => fetchGameRows({ waveId })),
    )
  ).flat();
  const games = toMyGames(rows, ids);

  return {
    bots,
    summaries: new Map(
      bots.map((bot) => [bot.id, summarizeLastWave(bot.id, history, games)]),
    ),
  };
}

/** Accord du participe : singulier jusqu’à un, pluriel au-delà. */
function plural(count: number): string {
  return count > 1 ? "s" : "";
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
      Dernière vague :{" "}
      {summary.gap === 0
        ? "Elo inchangé"
        : `${formatGap(summary.gap)} points d’Elo`}
      , {summary.wins} gagnée{plural(summary.wins)}, {summary.draws} nulle
      {plural(summary.draws)}, {summary.losses} perdue{plural(summary.losses)}
      {summary.technical > 0
        ? `, dont ${summary.technical} sur faute technique`
        : ""}
      .
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
  const [busy, setBusy] = useState<"probe" | "change" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Un retrait ne se défait pas, et le bouton voisine avec « Tester » : il
  // demande donc confirmation, sur place, avant de partir.
  const [confirming, setConfirming] = useState(false);
  // L'adresse ne se corrige que sur demande : le champ ne s'ouvre pas d'office,
  // l'écran montrant d'abord ce qui est déclaré.
  const [editingUrl, setEditingUrl] = useState(false);
  const [url, setUrl] = useState(bot.adresse_service);
  const [urlError, setUrlError] = useState<string | null>(null);

  const runProbe = async () => {
    setBusy("probe");
    setProbe(null);
    setFailure(null);
    setDone(null);
    try {
      setProbe(await probeBot(bot.id));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Sonde impossible.");
    } finally {
      setBusy(null);
    }
  };

  /**
   * Un refus **sous le champ nommé**, comme à la déclaration : `update-bot` rend
   * `field`, et une adresse refusée n'a rien à faire dans le message général.
   */
  const change = async (asked: BotChange) => {
    setBusy("change");
    setFailure(null);
    setUrlError(null);
    setDone(null);
    setConfirming(false);
    try {
      const reply = await updateBot(bot.id, asked);
      if (!reply.ok) {
        const message = reply.message ?? "Le service a refusé la demande.";
        if (reply.field === "url") setUrlError(message);
        else setFailure(message);
        return;
      }
      setDone(reply.message ?? null);
      setEditingUrl(false);
      onChanged();
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
        {/* Le chiffre qu'on vient chercher se lit à côté du nom, et non au fil
            d'une phrase de bilan. L'écart, lui, appartient au rappel de la
            dernière vague : il n'a de sens que rapporté à elle. Tant qu'aucune
            partie n'est classée, l'Elo n'est qu'une valeur de départ, et
            l'afficher laisserait croire à un rang gagné. */}
        <span className="bot-card__elo">
          {bot.parties_classees > 0 ? (
            <>
              <strong>{bot.elo}</strong> Elo
            </>
          ) : (
            "pas encore classée"
          )}
        </span>
      </p>
      {editingUrl ? (
        /* Le seul moyen de corriger une adresse : `authenticated` n'écrit rien
           sur `bots`, et `update-bot` refait le contrôle de la déclaration.
           Toucher la ligne rouvre au passage la qualification d'une IA restée
           en attente — c'est ce que la nouvelle adresse est censée réparer. */
        <form
          className="tournament-field bot-card__address-form"
          onSubmit={(event) => {
            event.preventDefault();
            void change({ url: url.trim() });
          }}
        >
          <label htmlFor={`adresse-${bot.id}`}>Adresse du service</label>
          <input
            id={`adresse-${bot.id}`}
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-describedby={urlError ? `adresse-${bot.id}-erreur` : undefined}
          />
          {urlError && (
            <p className="tournament-error" id={`adresse-${bot.id}-erreur`}>
              {urlError}
            </p>
          )}
          <span className="bot-card__actions">
            <button
              type="submit"
              className="secondary-button secondary-button--small"
              disabled={busy !== null}
            >
              {busy === "change" ? "Enregistrement…" : "Enregistrer l’adresse"}
            </button>
            <button
              type="button"
              className="secondary-button secondary-button--small"
              disabled={busy !== null}
              onClick={() => {
                setEditingUrl(false);
                setUrl(bot.adresse_service);
                setUrlError(null);
              }}
            >
              Annuler
            </button>
          </span>
        </form>
      ) : (
        <p className="bot-card__address">
          {/* L'adresse est une URL validée à la déclaration — https, port 443,
              hôte public —, jamais une chaîne libre : elle peut donc servir de
              lien sans autre précaution. */}
          <a href={bot.adresse_service} target="_blank" rel="noreferrer">
            {bot.adresse_service}
          </a>
        </p>
      )}
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
        {/* Une IA retirée ne revient pas, et son adresse ne sert plus : ne rien
            lui proposer vaut mieux qu'un bouton dont le service refusera la
            demande. */}
        {bot.statut !== "retiree" && !editingUrl && (
          <button
            type="button"
            className="secondary-button secondary-button--small"
            onClick={() => {
              // Repartir de l'adresse enregistrée, et non du dernier texte
              // saisi : le service la normalise, et c'est la sienne qui fait foi.
              setUrl(bot.adresse_service);
              setUrlError(null);
              setEditingUrl(true);
            }}
            disabled={busy !== null}
          >
            Corriger l’adresse
          </button>
        )}
        {/* Une qualification ratée ne se rejoue pas d'elle-même — ce serait
            harceler une adresse morte à chaque réveil. C'est donc l'auteur qui
            la redemande, une fois son service réparé. */}
        {bot.statut === "en_attente" && (
          <button
            type="button"
            className="secondary-button secondary-button--small"
            onClick={() => void change({ status: "en_attente" })}
            disabled={busy !== null}
          >
            Relancer la qualification
          </button>
        )}
        {bot.statut === "sommeil" && (
          <button
            type="button"
            className="secondary-button secondary-button--small"
            onClick={() => void change({ status: "en_attente" })}
            disabled={busy !== null}
          >
            Réactiver
          </button>
        )}
        {bot.statut !== "retiree" && (
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
              onClick={() => void change({ status: "retiree" })}
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
      {done && (
        <p className="tournament-note" role="status">
          {done}
        </p>
      )}
      {failure && (
        <p className="tournament-error" role="alert">
          {failure}
        </p>
      )}
    </li>
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
    () => (session ? loadMyBots(session.user.id) : pending<Payload>()),
    [ready, session?.user.id],
  );
  // Lecture séparée de la liste des IA : elle ne concerne qu'une poignée de
  // comptes, et une panne de son côté ne doit pas priver l'auteur de ses IA.
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

    </>
  );
}
