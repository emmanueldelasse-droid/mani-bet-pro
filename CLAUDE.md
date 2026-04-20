Lis SESSION.md. `.claude/onboarding.md` uniquement pour deploy/setup/reprise compte.
Branches: `claude/<topic>`. Update SESSION.md seulement si merge a impact critique.

RÈGLE OBLIGATOIRE pour toute IA modifiant SESSION.md ou ce fichier :
- Télégraphique français · pas de prose · pas d'articles superflus · pas d'emoji
- Listes à puces courtes · symboles `·` séparateur · `→` cause/résultat
- Refs code: `file:line` (ex: `worker.js:630`)
- Jamais dupliquer info stockée ailleurs (git log, issues, onboarding.md)
- Section > 15 lignes → extraire dans `.claude/<nom>.md`
- Après edit vérifier `wc -c SESSION.md` < 2000 octets
Non-respect = revert.
