/**
 * Category definitions.
 * Plaid's personal_finance_category.primary values are mapped here.
 * A keyword fallback is used for manual transactions.
 */

export type TransactionType = "income" | "expense" | "transfer";

export interface CategoryMeta {
  label: string;
  color: string;       // hex or tailwind arbitrary
  emoji: string;
  type: TransactionType;
}

export const CATEGORIES: Record<string, CategoryMeta> = {
  income:              { label: "Income",          color: "#00c896", emoji: "💰", type: "income"   },
  transfer_in:         { label: "Transfer In",     color: "#4ecdc4", emoji: "↙️", type: "transfer" },
  transfer_out:        { label: "Transfer Out",    color: "#f9ca24", emoji: "↗️", type: "transfer" },
  food_and_drink:      { label: "Dining & Bars",   color: "#ff7675", emoji: "🍔", type: "expense"  },
  groceries:           { label: "Groceries",       color: "#00b894", emoji: "🛒", type: "expense"  },
  shopping:            { label: "Shopping",        color: "#a29bfe", emoji: "🛍️", type: "expense"  },
  subscriptions:       { label: "Subscriptions",   color: "#6c5ce7", emoji: "📱", type: "expense"  },
  transportation:      { label: "Transport",       color: "#74b9ff", emoji: "🚗", type: "expense"  },
  entertainment:       { label: "Entertainment",   color: "#fd79a8", emoji: "🎬", type: "expense"  },
  rent_and_utilities:  { label: "Bills & Utilities", color: "#0984e3", emoji: "🏠", type: "expense" },
  medical:             { label: "Health",          color: "#e17055", emoji: "🏥", type: "expense"  },
  personal_care:       { label: "Personal Care",   color: "#fab1a0", emoji: "💅", type: "expense"  },
  travel:              { label: "Travel",          color: "#fdcb6e", emoji: "✈️", type: "expense"  },
  loan_payments:       { label: "Loan Payments",   color: "#d63031", emoji: "💳", type: "expense"  },
  home_improvement:    { label: "Home",            color: "#55efc4", emoji: "🔧", type: "expense"  },
  education:           { label: "Education",       color: "#ffeaa7", emoji: "📚", type: "expense"  },
  pets:                { label: "Pets",            color: "#a8e063", emoji: "🐾", type: "expense"  },
  donations:           { label: "Donations",       color: "#fd9644", emoji: "❤️", type: "expense"  },
  general_services:    { label: "Services",        color: "#636e72", emoji: "🔨", type: "expense"  },
  government:          { label: "Government",      color: "#b2bec3", emoji: "🏛️", type: "expense"  },
  bank_fees:           { label: "Bank Fees",       color: "#dfe6e9", emoji: "🏦", type: "expense"  },
  other:               { label: "Other",           color: "#747d8c", emoji: "📦", type: "expense"  },
};

/** Map Plaid's primary category string → our category key */
export function plaidCategoryToKey(plaidPrimary: string): string {
  const map: Record<string, string> = {
    INCOME:                    "income",
    TRANSFER_IN:               "transfer_in",
    TRANSFER_OUT:              "transfer_out",
    FOOD_AND_DRINK:            "food_and_drink",
    GENERAL_MERCHANDISE:       "shopping",
    TRANSPORTATION:            "transportation",
    ENTERTAINMENT:             "entertainment",
    RENT_AND_UTILITIES:        "rent_and_utilities",
    MEDICAL:                   "medical",
    PERSONAL_CARE:             "personal_care",
    TRAVEL:                    "travel",
    LOAN_PAYMENTS:             "loan_payments",
    HOME_IMPROVEMENT:          "home_improvement",
    GENERAL_SERVICES:          "general_services",
    GOVERNMENT_AND_NON_PROFIT: "government",
    BANK_FEES:                 "bank_fees",
    SUBSCRIPTION:              "subscriptions",
    EDUCATION:                 "education",
    GROCERIES:                 "groceries",
  };
  return map[plaidPrimary] ?? "other";
}

/** Keyword-based fallback for manual transactions */
const KEYWORD_RULES: Array<{ pattern: RegExp; category: string }> = [
  // ── Income ──────────────────────────────────────────────────────────────
  { pattern: /salary|payroll|direct.?dep|paycheck|wages|commission|bonus.?pay|employer|reimbursement|tax.?refund|irs.?refund/i, category: "income" },

  // ── Transfers (person-to-person; catch before other rules) ───────────────
  { pattern: /zelle|venmo|cash.?app|paypal.?transfer|square.?cash|google.?pay.?send|apple.?cash|wire.?transfer|peer.?to.?peer/i, category: "transfer_out" },

  // ── Groceries (before food_and_drink to win on grocery stores) ──────────
  { pattern: /whole.?foods|trader.?joe|safeway|kroger|aldi|publix|wegmans|sprouts|h-?e-?b|ralph|vons|albertson|costco|sam.?s.?club|bj.?s.?wholes|market.?basket|stop.?&.?shop|giant.?food|food.?lion|meijer|save.?a.?lot|winn.?dixie|piggly.?wiggly|hy.?vee|fresh.?market|lidl|winco|grocery.?outlet|smart.?&.?final|key.?food|stater.?bros|hannaford|price.?chopper|lucky.?supermarket|brookshire|dillons|fry.?s.?food|king.?sooper|pick.?n.?save|sendik|mart.?grocery|grocery|supermarket|food.?store/i, category: "groceries" },

  // ── Dining & Bars ────────────────────────────────────────────────────────
  { pattern: /uber.?eats|doordash|grubhub|postmates|seamless|caviar.?food|mcdonald|burger.?king|wendy.?s|pizza.?hut|domino|papa.?john|little.?caesar|starbucks|dunkin|caribou.?coffee|peet.?s.?coffee|chipotle|taco.?bell|chick.?fil.?a|panera|subway|jimmy.?john|jersey.?mike|firehouse.?sub|potbelly|restaurant|cafe|bistro|grille?|tavern|diner|brasserie|eatery|gastropub|bar |brewery|wingstop|ihop|cheesecake.?factory|applebee|outback|olive.?garden|five.?guys|shake.?shack|panda.?express|raising.?cane|cook.?out|sonic.?drive|whataburger|in.?n.?out|del.?taco|jack.?in.?the.?box|qdoba|moe.?s.?southwest|noodles.?&.?company|sweetgreen|cosi.?ing|corner.?bakery|la.?madeleine|bob.?evans|denny.?s|waffle.?house|cracker.?barrel|red.?lobster|longhorn|texas.?roadhouse|chili.?s|t.?g.?i|hooters|buffalo.?wild.?wings|dave.?&.?buster|hard.?rock.?cafe|benihana|p.?f.?chang|sushi|ramen|pho |thai.?food|indian.?cuisine|chinese.?food|mexican.?food/i, category: "food_and_drink" },

  // ── Subscriptions (streaming, software, SaaS) ────────────────────────────
  { pattern: /netflix|hulu|disney.?plus|disney\+|hbo.?max|max.?subscription|paramount.?plus|peacock|espn.?plus|apple.?tv.?plus|apple.?one|discovery.?plus|amc.?plus|shudder|mubi|criterion|spotify|apple.?music|youtube.?music|tidal|deezer|pandora|amazon.?music|youtube.?premium|amazon.?prime|twitch.?sub|crunchyroll|funimation|vrv.?sub|curiosity.?stream|sling.?tv|fubo.?tv|philo.?tv|directv.?stream|audible|kindle.?unlimited|scribd|adobe.?cc|adobe.?creative|figma.?sub|canva.?pro|microsoft.?365|office.?365|google.?one|google.?workspace|icloud.?storage|dropbox.?plus|box.?sub|notion.?plus|evernote|bear.?notes|obsidian|1password|lastpass|bitwarden|nordvpn|expressvpn|surfshark|patreon|substack|onlyfans|medium.?member|grammarly|jasper.?ai|chatgpt.?plus|openai|anthropic|github.?copilot|github.?pro|atlassian|jira.?sub|confluence|slack.?sub|zoom.?sub|webex|docusign|hellosign|squarespace|wix.?sub|shopify.?sub/i, category: "subscriptions" },

  // ── Entertainment (one-time, non-subscription) ───────────────────────────
  { pattern: /steam.?purchase|playstation.?store|xbox.?marketplace|nintendo.?eshop|epic.?games|gog.?purchase|ticketmaster|live.?nation|eventbrite|stubhub|seatgeek|vivid.?seats|movie.?ticket|theater.?ticket|cinema|amctheatres|regal.?cinema|imax|fandango|cinemark|alamo.?draft|harkins|marcus.?theater|comedy.?club|concert.?ticket|escape.?room|bowling|mini.?golf|trampoline.?park|topgolf|arcadefire|dave.?buster/i, category: "entertainment" },

  // ── Gas & Transportation ─────────────────────────────────────────────────
  { pattern: /uber(?!.?eats)|lyft|via.?ride|waymo|bird.?scooter|lime.?scooter|spin.?scooter|shell.?gas|bp.?gas|chevron|exxon|mobil.?gas|valero|sunoco|marathon.?gas|circle.?k|wawa.?gas|speedway|pilot.?travel|love.?s.?travel|casey.?s|quiktrip|kwik.?trip|racetrac|gas.?station|fuel.?pump|parking|parkwhiz|spothero|parkway|toll.?pay|e.?zpass|fastrak|sunpass|peach.?pass|metro|mta.|bart.|caltrain|metra|septa|wmata|mbta|trimet|sound.?transit|amtrak|greyhound|megabus|flixbus|zipcar|hertz|avis|budget.?rental|enterprise.?rent|national.?car|alamo.?rent|turo.?rental|getaround/i, category: "transportation" },

  // ── Bills & Utilities ────────────────────────────────────────────────────
  { pattern: /rent.?pay|mortgage.?pay|electric.?bill|water.?bill|gas.?bill|sewer.?bill|trash.?bill|internet.?bill|cable.?bill|comcast|xfinity|att.?bill|at&t.?bill|verizon.?bill|t.?mobile.?bill|spectrum.?internet|cox.?comm|frontier.?comm|pg&e|pge.?bill|con.?ed|duke.?energy|national.?grid|dominion.?energy|southern.?company|centerpoint|xcel.?energy|dte.?energy|firstenergy|ameren|entergy|utility.?pay|utilities.?pay|geico|progressive.?ins|state.?farm|allstate|liberty.?mutual|farmers.?ins|nationwide.?ins|usaa.?ins|travelers.?ins|aaa.?ins|auto.?insurance|home.?insurance|renter.?insurance/i, category: "rent_and_utilities" },

  // ── Health & Medical ─────────────────────────────────────────────────────
  { pattern: /hospital|urgent.?care|emergency.?room|patient.?pay|cvs.?pharmacy|walgreens|rite.?aid|duane.?reade|health.?mart|good.?rx|capsule.?pharmacy|pill.?club|hims.?rx|hers.?rx|dental.?office|orthodont|periodont|endodont|oral.?surgeon|optometry|lenscrafters|warby.?parker|vision.?works|doctor.?pay|physician.?billing|labcorp|quest.?diag|any.?lab.?test|mayo.?clinic|cleveland.?clinic|health.?system|med.?center|therapist|counseling|mental.?health|betterhelp|talkspace|headspace.?med|noom.?health|weight.?watchers|optum|humana|cigna|aetna|bcbs|anthem.?health|united.?health|medical.?billing|medical.?pay/i, category: "medical" },

  // ── Personal Care ────────────────────────────────────────────────────────
  { pattern: /salon|day.?spa|haircut|hair.?color|hair.?salon|nail.?salon|nail.?bar|waxing|threading|blowout|dry.?bar|great.?clips|sport.?clips|fantastic.?sam|planet.?fitness|la.?fitness|equinox|crunch.?gym|anytime.?fitness|24.?hour.?fitness|gold.?gym|lifetime.?fitness|orange.?theory|f45.?training|crossfit|yoga.?studio|pilates.?studio|barre.?studio|pure.?barre|solidcore|classpass|barber|massage.?therapy|massage.?envy|hand.?and.?stone|ulta.?beauty|sephora|sally.?beauty|credo.?beauty|bluemercury|bath.?&.?body/i, category: "personal_care" },

  // ── Travel ───────────────────────────────────────────────────────────────
  { pattern: /delta.?air|united.?air|american.?air|southwest.?air|jetblue|spirit.?air|frontier.?air|alaska.?air|hawaiian.?air|sun.?country|breeze.?air|avelo|flyfrontier|google.?flights|expedia|booking\.com|priceline|kayak|tripadvisor|hotels\.com|hotwire.?hotel|trivago|agoda|airbnb|vrbo|vacasa|marriott|hilton|hyatt|ihg.?hotel|wyndham|best.?western|choice.?hotel|radisson|omni.?hotel|four.?seasons|ritz.?carlton|kimpton|hotel.?stay|resort.?fee|airport.?parking|tsa.?precheck|global.?entry|clear.?biometric|travel.?insur/i, category: "travel" },

  // ── Education ────────────────────────────────────────────────────────────
  { pattern: /tuition.?pay|student.?loan.?pay|university|college.?pay|coursera|udemy|skillshare|masterclass|linkedinlearning|pluralsight|khan.?academy|codecademy|treehouse.?code|bootcamp|school.?pay|education.?fee|textbook|chegg|bartleby|course.?hero|quizlet|duolingo|rosetta.?stone|babbel|pimsleur|tutoring|sat.?prep|act.?prep|gre.?prep|gmat.?prep/i, category: "education" },

  // ── Pets ─────────────────────────────────────────────────────────────────
  { pattern: /petco|petsmart|chewy\.com|pet.?supplies.?plus|pet.?supermarket|tractor.?supply|pet.?food|dog.?food|cat.?food|vet.?clinic|veterinar|animal.?hospital|banfield.?pet|vca.?animal|pet.?smart|dog.?grooming|cat.?grooming|pet.?grooming|pet.?insurance|healthy.?paws|nationwide.?pet|pet.?meds|heartgard|frontline/i, category: "pets" },

  // ── Donations & Charity ──────────────────────────────────────────────────
  { pattern: /donation|donate|charity|red.?cross|united.?way|salvation.?army|goodwill|habitat.?for.?humanity|feeding.?america|st.?jude|make.?a.?wish|world.?vision|unicef|naacp|aclu.?donation|planned.?parenthood|sierra.?club|gofundme|kickstarter|indiegogo|fundly/i, category: "donations" },

  // ── Home & Hardware ──────────────────────────────────────────────────────
  { pattern: /home.?depot|lowe.?s|menards|ace.?hardware|true.?value|do.?it.?best|harbor.?freight|northern.?tool|fastenal|grainger|amazon.?home|ikea|wayfair|crate.?&.?barrel|pottery.?barn|west.?elm|restoration.?hardware|williams.?sonoma|bed.?bath|tuesday.?morning|homegoods|tj.?maxx.?home|furniture.?store|mattress.?firm|sleep.?number|purple.?mattress|casper.?bed|flooring|tile.?shop|carpet|plumber|electrician|contractor|landscap|home.?repair|handyman/i, category: "home_improvement" },

  // ── Loan & Debt Payments ─────────────────────────────────────────────────
  { pattern: /loan.?payment|student.?loan.?pay|car.?loan|auto.?loan|mortgage.?payment|nelnet|navient|sallie.?mae|mohela|aidvantage|great.?lakes.?loan|fed.?loan.?serv|discover.?student|sofi.?loan|earnest.?loan/i, category: "loan_payments" },

  // ── Bank Fees ────────────────────────────────────────────────────────────
  { pattern: /overdraft.?fee|nsf.?fee|monthly.?fee|maintenance.?fee|atm.?fee|wire.?fee|foreign.?transaction|service.?charge|late.?fee|returned.?item.?fee|account.?fee|bank.?fee/i, category: "bank_fees" },

  // ── Government ───────────────────────────────────────────────────────────
  { pattern: /irs.?payment|irs.?direct|tax.?payment|state.?tax|dmv.?fee|court.?fine|traffic.?fine|parking.?ticket|govt.?fee|government.?pay|us.?treasury|social.?security/i, category: "government" },

  // ── Shopping (broad retail — must come after more specific rules) ─────────
  { pattern: /amazon(?!.?music|.?prime.?video)|walmart|target|ebay|etsy|best.?buy|costco(?!.?food)|tjmaxx|tj.?maxx|marshalls|ross.?stores|nordstrom|macy.?s|bloomingdale|saks|neiman.?marcus|gap.?inc|old.?navy|banana.?republic|h&m|zara|forever.?21|uniqlo|nike.?store|adidas.?store|under.?armour|lululemon|apple.?store|samsung.?store|microsoft.?store|buy.?buy.?baby|toys.?r.?us|five.?below|dollar.?general|dollar.?tree|family.?dollar|big.?lots|tuesday.?morning|overstock|chewy(?!.?com)|shopify.?purchase|online.?store/i, category: "shopping" },
];

export function guessCategory(name: string, amount: number, merchantName?: string | null): { category: string; type: TransactionType } {
  // Negative amount = credit (money coming in)
  if (amount < 0) return { category: "income", type: "income" };

  // Test merchant name first (cleaner signal), then fall back to full description
  const targets = [merchantName, name].filter(Boolean) as string[];
  for (const target of targets) {
    for (const rule of KEYWORD_RULES) {
      if (rule.pattern.test(target)) {
        const meta = CATEGORIES[rule.category];
        return { category: rule.category, type: meta?.type ?? "expense" };
      }
    }
  }
  return { category: "other", type: "expense" };
}

export function getCategoryMeta(key: string): CategoryMeta {
  return CATEGORIES[key] ?? CATEGORIES.other;
}
