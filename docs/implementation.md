!Denna fil ska inte läsas av AI-agent!

# Lektion 2 Del A

Agenten fick i uppgift att skapa en plan utifrån informationen som fanns i Claude.md och Readme.me.
Vid skapandet av plan identifierade agenten flera saker som behövdes klargöras. Följande frågor ställdes av agenten:

- Ska den initiella implementationen vara en full MVP eller uppsatt utifrån vecka 1 av den 4 veckors roadmap som satts upp i readme.md filen.
  - Bestämde att köra full MVP
- Claude.md kräver godkännande av utomstående dependencies. Vilka ska godkännas:
  - Valde att godkänna 2 av 3 då den tredje inte var full nödvändigt.

Vad den missade att fråga efter är test ramverk och process (dock inlagt i planen som ännu ej godkänt ramverk) samt om kod standard för projektet. Dessa saker hade jag medvetet lämnat utanför dokumentationen för att se om agenten har möjlighet att kunna fråga om saker som brukar ingå i best practice.

Jag valde att fortsatt utveckla planen med test ramverk och pipeline för att ai agenten ska göra code reviews vid prs. Där ai agenterna sedan togs bort pga för hög token användning.

Efter att alla 4 faserna utvecklats kunde projektet köras och utförde den grundläggande funktionaliteten samt kunde release göras direkt för att sedan kunna köra applikationen i docker. Dock var inte resultatet den som hade föreställts, därav hade det behövts en tydligare kravställning innan planen formades.
