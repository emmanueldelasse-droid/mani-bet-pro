Lis SESSION.md. `.claude/onboarding.md` uniquement pour deploy/setup/reprise compte.
Branches: `claude/<topic>`. Update SESSION.md seulement si merge a impact critique.

RÈGLE OBLIGATOIRE pour toute IA modifiant SESSION.md ou ce fichier :
- Télégraphique français · pas de prose · pas d'articles superflus · pas d'emoji
- Listes à puces courtes · symboles `·` séparateur · `→` cause/résultat
- Refs code: `file:line` (ex: `worker.js:630`)
- Jamais dupliquer info stockée ailleurs (git log, issues, onboarding.md)
- Section > 15 lignes → extraire dans `.claude/<nom>.md`
- Après edit vérifier `wc -c SESSION.md` < 2500 octets
Non-respect = revert.

RÈGLE OBLIGATOIRE réponses conversationnelles au user (hors fichiers `.md`) :
- Vocabulaire simple et accessible, français courant
- Aucun jargon technique brut sans explication (ex: "KV" → "base de clé-valeur Cloudflare")
- Analogies du quotidien quand un concept est abstrait
- Exemples concrets avec vrais chiffres/noms de joueurs plutôt qu'abstrait
- Structure visuelle : titres courts, listes à puces, tableaux pour comparer
- Quand on donne une commande CLI : préciser où la taper (Terminal Mac, PowerShell Windows, navigateur...)
- Éviter : "il suffit de...", "simplement...", "trivial" → souvent perçu comme condescendant si le user galère
- Si le user montre qu'il ne sait pas un truc : ne jamais présumer qu'il devrait savoir, expliquer
Non-respect = user frustré, perte de temps.
