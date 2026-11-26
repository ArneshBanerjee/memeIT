import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(
  new URL("../src/preview-search.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { searchPreview } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const metadata = JSON.parse(
  readFileSync(
    new URL("../assets/internet-metadata.json", import.meta.url),
    "utf8",
  ),
);
const supplements = JSON.parse(
  readFileSync(
    new URL("../assets/public-supplemental.json", import.meta.url),
    "utf8",
  ),
);
const catalog = metadata.map((item) => ({
  ...item,
  id: `${item.source}:${item.id}`,
  title: "",
}));
for (const item of supplements) {
  const index = catalog.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) catalog[index] = item;
  else catalog.push(item);
}
const cookedDog = "imgflip:574931918";
test("descriptions, slang, word forms and swapped letters find the actual Cooked Dog", () => {
  for (const query of [
    "dog cooked",
    "god eye closed",
    "brown dog closing his eyes in the sunset",
    "labrador shutting eyes accepting fate",
    "dog is doomed",
  ]) {
    assert.equal(searchPreview(catalog, query)[0]?.id, cookedDog, query);
  }
});
test("different visual scenes do not collapse to the same animal reaction", () => {
  for (const query of [
    "dog in room on fire",
    "pretending everything is fine while the room burns",
  ]) {
    const first = searchPreview(catalog, query)[0];
    assert.match(first?.description || "", /flames|burning|fire/i, query);
    assert.notEqual(first?.id, cookedDog);
  }
  const first = searchPreview(
    catalog,
    "sweating man choosing two red buttons",
  )[0];
  assert.match(first?.description || "", /buttons/i);
});
test("word boundaries and conservative spelling avoid substring-only matches", () => {
  const examples = [
    { id: "car", title: "car", description: "A red car on the road", tags: [] },
    {
      id: "cat",
      title: "cat",
      description: "A white cat in the kitchen",
      tags: [],
    },
  ];
  assert.equal(searchPreview(examples, "cat")[0].id, "cat");
  assert.equal(searchPreview(examples, "car")[0].id, "car");
  assert.deepEqual(searchPreview(examples, "ar"), []);
});
test("empty browsing retains source order", () => {
  assert.deepEqual(searchPreview(catalog, ""), catalog);
});

test("visual descriptions retrieve Distracted Boyfriend without titles", () => {
  const scenes = catalog.map((item) => ({ ...item, title: "" }));
  for (const query of [
    "the guy looking back at other girl meme",
    "man turns to stare at another woman while his girlfriend looks annoyed",
  ]) {
    assert.ok(
      ["imgflip:112126428", "memegen:db"].includes(
        searchPreview(scenes, query)[0]?.id,
      ),
      query,
    );
  }
});

test('numeric and slang names retrieve six-seven formats', () => {
  for (const query of ['6 7', '67', 'six seven', 'kid doing the six seven hand gesture']) {
    assert.ok(['imgflip:616822082','imgflip:629895185'].includes(searchPreview(catalog, query)[0]?.id), query);
  }
});

// Provider IDs/titles captured from both complete public feeds on 2026-11-26:
// https://api.imgflip.com/get_memes and https://api.memegen.link/templates.
// Keep this deterministic: tests never depend on a network request or trending order.
const providerTitleSnapshot = [
  ["imgflip:181913649", "Drake Hotline Bling"],
  ["imgflip:87743020", "Two Buttons"],
  ["imgflip:112126428", "Distracted Boyfriend"],
  ["imgflip:222403160", "Bernie I Am Once Again Asking For Your Support"],
  ["imgflip:217743513", "UNO Draw 25 Cards"],
  ["imgflip:252600902", "Always Has Been"],
  ["imgflip:322841258", "Anakin Padme 4 Panel"],
  ["imgflip:124822590", "Left Exit 12 Off Ramp"],
  ["imgflip:131940431", "Gru's Plan"],
  ["imgflip:135256802", "Epic Handshake"],
  ["imgflip:97984", "Disaster Girl"],
  ["imgflip:131087935", "Running Away Balloon"],
  ["imgflip:4087833", "Waiting Skeleton"],
  ["imgflip:161865971", "Marked Safe From"],
  ["imgflip:80707627", "Sad Pablo Escobar"],
  ["imgflip:91538330", "X, X Everywhere"],
  ["imgflip:224015000", "Bernie Sanders Once Again Asking"],
  ["imgflip:129242436", "Change My Mind"],
  ["imgflip:309868304", "Trade Offer"],
  ["imgflip:188390779", "Woman Yelling At Cat"],
  ["imgflip:124055727", "Y'all Got Any More Of That"],
  ["imgflip:438680", "Batman Slapping Robin"],
  ["imgflip:102156234", "Mocking Spongebob"],
  ["imgflip:61579", "One Does Not Simply"],
  ["imgflip:67452763", "Squidward window"],
  ["imgflip:101470", "Ancient Aliens"],
  ["imgflip:100777631", "Is This A Pigeon"],
  ["imgflip:427308417", "0 days without (Lenny, Simpsons)"],
  ["imgflip:28251713", "Oprah You Get A"],
  ["imgflip:177682295", "You Guys are Getting Paid"],
  ["imgflip:505705955", "Absolute Cinema"],
  ["imgflip:180190441", "They're The Same Picture"],
  ["imgflip:252758727", "Mother Ignoring Kid Drowning In A Pool"],
  ["imgflip:3218037", "This Is Where I'd Put My Trophy If I Had One"],
  ["imgflip:208915813", "George Bush 9/11"],
  ["imgflip:93895088", "Expanding Brain"],
  ["imgflip:79132341", "Bike Fall"],
  ["imgflip:55311130", "This Is Fine"],
  ["imgflip:247375501", "Buff Doge vs. Cheems"],
  ["imgflip:178591752", "Tuxedo Winnie The Pooh"],
  ["imgflip:370867422", "Megamind peeking"],
  ["imgflip:284929871", "They don't know"],
  ["imgflip:77045868", "Pawn Stars Best I Can Do"],
  ["imgflip:27813981", "Hide the Pain Harold"],
  ["imgflip:89370399", "Roll Safe Think About It"],
  ["imgflip:533936279", "Bell Curve"],
  ["imgflip:110163934", "I Bet He's Thinking About Other Women"],
  ["imgflip:148909805", "Monkey Puppet"],
  ["imgflip:171305372", "Soldier protecting sleeping child"],
  ["imgflip:195515965", "Clown Applying Makeup"],
  ["imgflip:206151308", "Spider Man Triple"],
  ["imgflip:354700819", "Two guys on a bus"],
  ["imgflip:163573", "Imagination Spongebob"],
  ["imgflip:61585", "Bad Luck Brian"],
  ["imgflip:137501417", "Friendship ended"],
  ["imgflip:84341851", "Evil Kermit"],
  ["imgflip:162372564", "Domino Effect"],
  ["imgflip:114585149", "Inhaling Seagull"],
  ["imgflip:1035805", "Boardroom Meeting Suggestion"],
  ["imgflip:187102311", "Three-headed Dragon"],
  ["imgflip:166969924", "Flex Tape"],
  ["imgflip:145139900", "Scooby doo mask reveal"],
  ["imgflip:99683372", "Sleeping Shaq"],
  ["imgflip:119215120", "Types of Headaches meme"],
  ["imgflip:129315248", "No - Yes"],
  ["imgflip:316466202", "where monkey"],
  ["imgflip:259237855", "Laughing Leo"],
  ["imgflip:216523697", "All My Homies Hate"],
  ["imgflip:247113703", "A train hitting a school bus"],
  ["imgflip:226297822", "Panik Kalm Panik"],
  ["imgflip:110133729", "spiderman pointing at spiderman"],
  ["imgflip:155067746", "Surprised Pikachu"],
  ["imgflip:224514655", "Anime Girl Hiding from Terminator"],
  ["imgflip:234202281", "AJ Styles & Undertaker"],
  ["imgflip:61520", "Futurama Fry"],
  ["imgflip:221578498", "Grant Gustin over grave"],
  ["imgflip:104893621", "Grim Reaper Knocking Door"],
  ["imgflip:101956210", "Whisper and Goosebumps"],
  ["imgflip:133946291", "You know, I'm something of a scientist myself"],
  ["imgflip:135678846", "Who Killed Hannibal"],
  ["imgflip:61556", "Grandma Finds The Internet"],
  ["imgflip:371619279", "Megamind no bitches"],
  ["imgflip:72525473", "say the line bart! simpsons"],
  ["imgflip:91998305", "Drake Blank"],
  ["imgflip:142009471", "is this butterfly"],
  ["imgflip:119139145", "Blank Nut Button"],
  ["imgflip:20007896", "c'mon do something"],
  ["imgflip:92084495", "Charlie Conspiracy (Always Sunny in Philidelphia)"],
  ["imgflip:342785297", "Gus Fring we are not the same"],
  ["imgflip:441974336", "A second plane has just hit"],
  ["imgflip:309668311", "Two Paths"],
  ["imgflip:14371066", "Star Wars Yoda"],
  ["imgflip:29562797", "I'm The Captain Now"],
  ["imgflip:29617627", "Look At Me"],
  ["imgflip:123999232", "The Scroll Of Truth"],
  ["imgflip:249257686", "Bugs bunny communist"],
  ["imgflip:5496396", "Leonardo Dicaprio Cheers"],
  ["imgflip:21735", "The Rock Driving"],
  ["imgflip:91545132", "Trump Bill Signing"],
  ["imgflip:101288", "Third World Skeptical Kid"],
  ["memegen:3hd", "Three-Headed Dragon"],
  ["memegen:aag", "Ancient Aliens Guy"],
  ["memegen:ackbar", "It's A Trap!"],
  ["memegen:afraid", "Afraid to Ask Andy"],
  ["memegen:agnes", "Agnes Harkness Winking"],
  ["memegen:aint-got-time", "Sweet Brown"],
  ["memegen:ams", "Awkward Moment Seal"],
  ["memegen:ants", "Do You Want Ants?"],
  ["memegen:apcr", "Almost Politically Correct Redneck"],
  ["memegen:astronaut", "Always Has Been"],
  ["memegen:atis", "And Then I Said"],
  ["memegen:away", "Life... Finds a Way"],
  ["memegen:awesome", "Socially Awesome Penguin"],
  ["memegen:awesome-awkward", "Socially Awesome Awkward Penguin"],
  ["memegen:awkward", "Socially Awkward Penguin"],
  ["memegen:awkward-awesome", "Socially Awkward Awesome Penguin"],
  ["memegen:bad", "You Should Feel Bad"],
  ["memegen:badchoice", "Milk Was a Bad Choice"],
  ["memegen:balloon", "Running Away Balloon"],
  ["memegen:bd", "Butthurt Dweller"],
  ["memegen:because", "Men in Black"],
  ["memegen:bender", "I'm Going to Build My Own Theme Park"],
  ["memegen:bihw", "But It's Honest Work"],
  ["memegen:bilbo", "Why Shouldn't I Keep It"],
  ["memegen:biw", "Baby Insanity Wolf"],
  ["memegen:blb", "Bad Luck Brian"],
  ["memegen:boat", "I Should Buy a Boat Cat"],
  ["memegen:bongo", "Bongo Cat"],
  ["memegen:both", "Why Not Both?"],
  ["memegen:box", "What's in the box!?"],
  ["memegen:bs", "This is Bull, Shark"],
  ["memegen:bus", "Two Guys on a Bus"],
  ["memegen:buzz", "X, X Everywhere"],
  ["memegen:cake", "Office Space Milton"],
  ["memegen:captain", "I am the Captain Now"],
  ["memegen:captain-america", "Captain America Elevator Fight Dad Joke"],
  ["memegen:cb", "Confession Bear"],
  ["memegen:cbb", "Communist Bugs Bunny"],
  ["memegen:cbg", "Comic Book Guy"],
  ["memegen:center", "What is this, a Center for Ants?!"],
  ["memegen:ch", "Captain Hindsight"],
  ["memegen:chair", "American Chopper Argument"],
  ["memegen:cheems", "Cheems"],
  ["memegen:chosen", "You Were the Chosen One!"],
  ["memegen:cmm", "Change My Mind"],
  ["memegen:country", "What a Country"],
  ["memegen:crazypills", "I Feel Like I'm Taking Crazy Pills"],
  ["memegen:crow", "Get Better Material"],
  ["memegen:crowd", "Soccer Celebration In A Bar"],
  ["memegen:cryingfloor", "Crying on Floor"],
  ["memegen:db", "Distracted Boyfriend"],
  ["memegen:dbg", "Expectation vs. Reality"],
  ["memegen:dg", "Distracted Girlfriend"],
  ["memegen:disastergirl", "Disaster Girl"],
  ["memegen:dodgson", "See? Nobody Cares"],
  ["memegen:doge", "Doge"],
  ["memegen:dragon", "What Color Do You Want Your Dragon"],
  ["memegen:drake", "Drakeposting"],
  ["memegen:drowning", "Drowning High Five"],
  ["memegen:drunk", "Drunk Baby"],
  ["memegen:ds", "Daily Struggle"],
  ["memegen:dsm", "Dating Site Murderer"],
  ["memegen:dwight", "Schrute Facts"],
  ["memegen:elf", "You Sit on a Throne of Lies"],
  ["memegen:elmo", "Elmo Choosing Cocaine"],
  ["memegen:ermg", "Ermahgerd"],
  ["memegen:exit", "Left Exit 12 Off Ramp"],
  ["memegen:fa", "Forever Alone"],
  ["memegen:facepalm", "Facepalm"],
  ["memegen:fbf", "Foul Bachelor Frog"],
  ["memegen:feelsgood", "Feels Good"],
  ["memegen:fetch", "Stop Trying to Make Fetch Happen"],
  ["memegen:fine", "This is Fine"],
  ["memegen:firsttry", "First Try!"],
  ["memegen:fmr", "Fuck Me, Right?"],
  ["memegen:friends", "Are You Two Friends?"],
  ["memegen:fry", "Futurama Fry"],
  ["memegen:fwp", "First World Problems"],
  ["memegen:gandalf", "Confused Gandalf"],
  ["memegen:gb", "Galaxy Brain"],
  ["memegen:gears", "You Know What Really Grinds My Gears?"],
  ["memegen:genie", "Genie Lamp"],
  ["memegen:ggg", "Good Guy Greg"],
  ["memegen:glasses", "Peter Parker's Glasses"],
  ["memegen:gone", "And It's Gone"],
  ["memegen:grave", "Grant Gustin Next To Oliver Queen's Grave"],
  ["memegen:gru", "Gru's Plan"],
  ["memegen:grumpycat", "Grumpy Cat"],
  ["memegen:hagrid", "I Should Not Have Said That"],
  ["memegen:handshake", "Epic Handshake"],
  ["memegen:happening", "It's Happening"],
  ["memegen:harold", "Hide the Pain Harold"],
  ["memegen:headaches", "Types of Headaches"],
  ["memegen:hipster", "Hipster Barista"],
  ["memegen:home", "We Have Food at Home"],
  ["memegen:icanhas", "I Can Has Cheezburger?"],
  ["memegen:imsorry", "Oh, I'm Sorry, I Thought This Was America"],
  ["memegen:inigo", "Inigo Montoya"],
  ["memegen:interesting", "The Most Interesting Man in the World"],
  ["memegen:ive", "Jony Ive Redesigns Things"],
  ["memegen:iw", "Insanity Wolf"],
  ["memegen:jd", "Joseph Ducreux"],
  ["memegen:jetpack", "Nothing To Do Here"],
  ["memegen:jim", "Jim Halpert Pointing to Whiteboard"],
  ["memegen:joker", "It's Simple, Kill the Batman"],
  ["memegen:jw", "Probably Not a Good Idea"],
  ["memegen:keanu", "Conspiracy Keanu"],
  ["memegen:kermit", "But That's None of My Business"],
  ["memegen:khaby-lame", "Khaby Lame Shrug"],
  ["memegen:kk", "Karate Kyle"],
  ["memegen:kombucha", "Kombucha Girl"],
  ["memegen:kramer", "Kramer, What's Going On In There?"],
  ["memegen:leo", "Leo Strutting"],
  ["memegen:light", "Everything the Light Touches is Our Kingdom"],
  ["memegen:live", "Do It Live!"],
  ["memegen:ll", "Laughing Lizard"],
  ["memegen:lrv", "Laundry Room Viking"],
  ["memegen:made", "I Made This"],
  ["memegen:mb", "Member Berries"],
  ["memegen:michael-scott", "Michael Scott No God No"],
  ["memegen:midwit", "Midwit"],
  ["memegen:millers", "You Guys Are Getting Paid?"],
  ["memegen:mini-keanu", "Mini Keanu Reeves"],
  ["memegen:mmm", "Minor Mistake Marvin"],
  ["memegen:money", "Shut Up and Take My Money!"],
  ["memegen:mordor", "One Does Not Simply Walk into Mordor"],
  ["memegen:morpheus", "Matrix Morpheus"],
  ["memegen:mouth", "Woman Holding Dog's Mouth"],
  ["memegen:mw", "I Guarantee It"],
  ["memegen:nails", "Guy Hammering Nails Into Sand"],
  ["memegen:nice", "So I Got That Goin' For Me, Which is Nice"],
  ["memegen:noah", "What the Hell is This?"],
  ["memegen:noidea", "I Have No Idea What I'm Doing"],
  ["memegen:ntot", "No Take, Only Throw"],
  ["memegen:oag", "Overly Attached Girlfriend"],
  ["memegen:officespace", "That Would Be Great"],
  ["memegen:older", "An Older Code Sir, But It Checks Out"],
  ["memegen:oprah", "Oprah You Get a Car"],
  ["memegen:panik-kalm-panik", "Panik Kalm Panik"],
  ["memegen:patrick", "Push it somewhere else Patrick"],
  ["memegen:perfection", "Perfection"],
  ["memegen:persian", "Persian Cat Room Guardian"],
  ["memegen:philosoraptor", "Philosoraptor"],
  ["memegen:pigeon", "Is This a Pigeon?"],
  ["memegen:pooh", "Tuxedo Winnie the Pooh"],
  ["memegen:pool", "Mother Ignoring Kid Drowning In A Pool"],
  ["memegen:prop3", "Too Confusing, Too Extreme"],
  ["memegen:ptj", "Phoebe Teaching Joey"],
  ["memegen:puffin", "Unpopular opinion puffin"],
  ["memegen:red", "Oh, Is That What We're Going to Do Today?"],
  ["memegen:regret", "I Immediately Regret This Decision!"],
  ["memegen:remembers", "Pepperidge Farm Remembers"],
  ["memegen:reveal", "Scooby Doo Reveal"],
  ["memegen:right", "Anakin and Padme Change the World For the Better"],
  ["memegen:rollsafe", "Roll Safe"],
  ["memegen:sad-biden", "Sad Joe Biden"],
  ["memegen:sad-boehner", "Sad John Boehner"],
  ["memegen:sad-bush", "Sad George Bush"],
  ["memegen:sad-clinton", "Sad Bill Clinton"],
  ["memegen:sad-obama", "Sad Barack Obama"],
  ["memegen:sadfrog", "Feels Bad Man"],
  ["memegen:saltbae", "Salt Bae"],
  ["memegen:same", "They're The Same Picture"],
  ["memegen:sarcasticbear", "Sarcastic Bear"],
  ["memegen:say", "Say the Line, Bart!"],
  ["memegen:sb", "Scumbag Brain"],
  ["memegen:scc", "Sudden Clarity Clarence"],
  ["memegen:seagull", "Inhaling Seagull"],
  ["memegen:sf", "Sealed Fate"],
  ["memegen:sk", "Skeptical Third World Kid"],
  ["memegen:ski", "Super Cool Ski Instructor"],
  ["memegen:slap", "Will Smith Slapping Chris Rock"],
  ["memegen:snek", "Skeptical Snake"],
  ["memegen:soa", "Seal of Approval"],
  ["memegen:sohappy", "I Would Be So Happy"],
  ["memegen:sohot", "So Hot Right Now"],
  ["memegen:soup-nazi", "No Soup for You"],
  ["memegen:sparta", "This is Sparta!"],
  ["memegen:spiderman", "Spider-Man Pointing at Spider-Man"],
  ["memegen:spirit", "Fake Spirit Halloween Costume"],
  ["memegen:spongebob", "Mocking Spongebob"],
  ["memegen:ss", "Scumbag Steve"],
  ["memegen:stew", "Baby, You've Got a Stew Going"],
  ["memegen:stonks", "Stonks"],
  ["memegen:stop", "Stop It Patrick You're Scaring Him"],
  ["memegen:stop-it", "Stop It, Get Some Help"],
  ["memegen:success", "Success Kid"],
  ["memegen:tenguy", "10 Guy"],
  ["memegen:toohigh", "The Rent Is Too Damn High"],
  ["memegen:touch", "Principal Skinner"],
  ["memegen:tried", "At Least You Tried"],
  ["memegen:trump", "Donald Trump"],
  ["memegen:ugandanknuck", "Ugandan Knuckles"],
  ["memegen:vince", "Vince McMahon Reaction"],
  ["memegen:wallet", "Patrick Star's Wallet"],
  ["memegen:waygd", "What Are Ya Gonna Do?"],
  ["memegen:wddth", "We Don't Do That Here"],
  ["memegen:whatyear", "What Year Is It?"],
  ["memegen:winter", "Winter is coming"],
  ["memegen:wishes", "Genie Rules"],
  ["memegen:wkh", "Who Killed Hannibal?"],
  ["memegen:woman-cat", "Woman Yelling at a Cat"],
  ["memegen:wonka", "Condescending Wonka"],
  ["memegen:worst", "The Worst Day Of Your Life So Far"],
  ["memegen:xy", "X all the Y"],
  ["memegen:yallgot", "Y'all Got Any More of Them"],
  ["memegen:yodawg", "Xzibit Yo Dawg"],
  ["memegen:yuno", "Y U NO Guy"],
  ["memegen:zero-wing", "All Your Base Are Belong to Us"],

];
const descriptionsById = new Map(metadata.map(item => [`${item.source}:${item.id}`, item]));
const realTitleCatalog = providerTitleSnapshot.map(([id, title]) => {
  const extra = descriptionsById.get(id);
  return { id, title, description: extra?.description || '', tags: extra?.tags || [] };
});
for (const item of supplements) {
  if (!realTitleCatalog.some(candidate => candidate.id === item.id)) realTitleCatalog.push(item);
}

test('visual descriptions beat misleading title matches across real provider catalogs', () => {
  assert.equal(providerTitleSnapshot.length, 309);
  assert.ok(realTitleCatalog.some(item => item.title === 'Shocked Black Guy'));
  for (const query of [
    'the guy looking back at other girl meme',
    'guy back at other girl',
    'man turns to stare at another woman while his girlfriend looks annoyed',
    'dude checking out a different woman',
  ]) {
    assert.ok(['imgflip:112126428', 'memegen:db'].includes(searchPreview(realTitleCatalog, query)[0]?.id), query);
  }
});

test('real titles retain exact-name, typo, numeric, and distinct-scene retrieval', () => {
  for (const name of ['Shocked Black Guy', 'Distracted Boyfriend', 'Drake Hotline Bling', 'Disaster Girl']) {
    assert.equal(searchPreview(realTitleCatalog, name)[0]?.title, name, name);
  }
  for (const query of ['dog cooked', 'god eye closed', 'brown dog closing his eyes in the sunset']) {
    assert.equal(searchPreview(realTitleCatalog, query)[0]?.id, cookedDog, query);
  }
  for (const query of ['6 7', '67', 'six seven', 'kid doing the six seven hand gesture']) {
    assert.ok(['imgflip:616822082', 'imgflip:629895185'].includes(searchPreview(realTitleCatalog, query)[0]?.id), query);
  }
  assert.match(searchPreview(realTitleCatalog, 'dog in room on fire')[0]?.description || '', /flames|burning|fire/i);
  assert.match(searchPreview(realTitleCatalog, 'sweating man choosing two red buttons')[0]?.description || '', /buttons/i);
});
