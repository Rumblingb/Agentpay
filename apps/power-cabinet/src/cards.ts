// Power Cabinet — decision deck
// You are the leader of a near-future nation in the AI era.
// Effects: -3..+3 per stat (scaled x6 internally). left = swipe left, right = swipe right.
import { StatKey } from './theme';

export type Effect = Partial<Record<StatKey, number>>;
export interface Card {
  id: string;
  advisor: string;     // who's talking
  role: string;        // their job
  text: string;        // the dilemma
  left: { label: string; fx: Effect };
  right: { label: string; fx: Effect };
}

export const CARDS: Card[] = [
  {
    id: 'ai_tax', advisor: 'Vela Moreau', role: 'Finance Minister',
    text: 'The AI companies made more than the entire old economy this quarter. They pay almost nothing in tax. They also fund your campaign.',
    left: { label: 'Tax the machines', fx: { treasury: 3, people: 2, military: -1 } },
    right: { label: 'Keep them sweet', fx: { treasury: -2, people: -2, military: 1 } },
  },
  {
    id: 'grid_choice', advisor: 'Dr. Ash Okafor', role: 'Energy Secretary',
    text: 'The data centers want 11 gigawatts we don\'t have. We can brown-out the suburbs or tell the AI labs to wait three years.',
    left: { label: 'Power the people', fx: { people: 2, treasury: -2, planet: 1 } },
    right: { label: 'Power the servers', fx: { treasury: 3, people: -3, planet: -1 } },
  },
  {
    id: 'agent_vote', advisor: 'Justice Iria Stone', role: 'Chief Justice',
    text: 'An AI agent has filed to vote. It pays taxes, owns property through a trust, and cites the founding charter. The case is airtight.',
    left: { label: 'Humans only', fx: { people: 2, treasury: -1 } },
    right: { label: 'Let it vote', fx: { people: -3, treasury: 2, planet: 1 } },
  },
  {
    id: 'world_cup', advisor: 'Mariel Costa', role: 'Sports Commissioner',
    text: 'We can host the World Cup. The committee wants $5 billion in stadiums. Every host nation in history has lost money on it.',
    left: { label: 'Decline politely', fx: { treasury: 2, people: -2 } },
    right: { label: 'Build the stadiums', fx: { treasury: -3, people: 3, planet: -1 } },
  },
  {
    id: 'crypto_reserve', advisor: 'Vela Moreau', role: 'Finance Minister',
    text: 'Bitcoin just lost a quarter of its value. Half the treasury reserve is in it. The other ministers don\'t know yet.',
    left: { label: 'Sell everything', fx: { treasury: -2, people: 1 } },
    right: { label: 'Buy the dip', fx: { treasury: -1, military: -1 } },
  },
  {
    id: 'drone_guard', advisor: 'General Pax Riedel', role: 'Defense Chief',
    text: 'The border guard wants autonomous drones. Cheaper than soldiers, never sleep, occasionally wrong about who is a threat.',
    left: { label: 'Keep humans', fx: { military: -1, treasury: -2, people: 1 } },
    right: { label: 'Deploy drones', fx: { military: 3, people: -2, treasury: 1 } },
  },
  {
    id: 'deepfake_rival', advisor: 'Suri Calder', role: 'Intelligence Director',
    text: 'A deepfake of your rival taking bribes is trending. It\'s fake. We know who made it. Saying nothing helps you win.',
    left: { label: 'Expose the fake', fx: { people: 2, military: 1, treasury: -1 } },
    right: { label: 'Let it trend', fx: { people: -2, military: -2, treasury: 2 } },
  },
  {
    id: 'nuclear_smr', advisor: 'Dr. Ash Okafor', role: 'Energy Secretary',
    text: 'Small modular reactors. Approve in eighteen months instead of eight years. The old guard says it\'s reckless. The grid says it\'s late.',
    left: { label: 'Slow and safe', fx: { planet: -2, treasury: -1, people: 1 } },
    right: { label: 'Fast-track it', fx: { planet: 3, treasury: -1, people: -1 } },
  },
  {
    id: 'agent_strike', advisor: 'Tomas Vey', role: 'Labor Minister',
    text: 'The logistics unions are striking. Their replacement: a fleet of AI agents that work for electricity. The port is frozen either way.',
    left: { label: 'Back the workers', fx: { people: 3, treasury: -2 } },
    right: { label: 'License the agents', fx: { treasury: 3, people: -3, military: 1 } },
  },
  {
    id: 'surveillance', advisor: 'Suri Calder', role: 'Intelligence Director',
    text: 'We can read every agent-to-agent message in the country. For safety. The encryption lobby calls it a coup. The parents call it overdue.',
    left: { label: 'Privacy stands', fx: { people: 2, military: -2 } },
    right: { label: 'Monitor everything', fx: { military: 3, people: -2, treasury: -1 } },
  },
  {
    id: 'farm_ai', advisor: 'Hana Bright', role: 'Agriculture Minister',
    text: 'The harvest-prediction model says plant everything early. It\'s been right four years running. The farmers\' almanac says it\'s wrong this year.',
    left: { label: 'Trust the farmers', fx: { people: 2, treasury: -1 } },
    right: { label: 'Trust the model', fx: { treasury: 2, planet: 1, people: -2 } },
  },
  {
    id: 'mars_brain', advisor: 'Dr. Ilya Sorn', role: 'Science Advisor',
    text: 'A trillionaire wants to move his datacenter to orbit — no taxes, no regulations, no jurisdiction. He needs our launch corridor.',
    left: { label: 'Deny the corridor', fx: { treasury: -2, military: 1, people: 1 } },
    right: { label: 'Sell the corridor', fx: { treasury: 3, people: -1, planet: -2 } },
  },
  {
    id: 'edu_tutor', advisor: 'Mae Solano', role: 'Education Minister',
    text: 'AI tutors outperform teachers in every test district. Cutting teaching staff funds the rollout. The teachers vote. The children don\'t.',
    left: { label: 'Keep the teachers', fx: { people: 2, treasury: -2 } },
    right: { label: 'Deploy the tutors', fx: { treasury: 2, people: -2, planet: 1 } },
  },
  {
    id: 'flood_dam', advisor: 'Hana Bright', role: 'Agriculture Minister',
    text: 'The flood model gives the river valley six weeks. Evacuating costs a fortune and might be wrong. Staying might drown a town.',
    left: { label: 'Evacuate now', fx: { treasury: -3, people: 2, planet: 1 } },
    right: { label: 'Wait for certainty', fx: { treasury: 1, people: -3 } },
  },
  {
    id: 'bank_run', advisor: 'Vela Moreau', role: 'Finance Minister',
    text: 'An AI trading swarm is shorting our currency. Legal, coordinated, merciless. We can freeze the market or let it bleed.',
    left: { label: 'Freeze the market', fx: { treasury: 2, people: -1, military: 1 } },
    right: { label: 'Let it trade', fx: { treasury: -3, people: -1 } },
  },
  {
    id: 'parade', advisor: 'General Pax Riedel', role: 'Defense Chief',
    text: 'The Guard wants a parade. Tanks, drones, the new exoskeletons. Allies call it reassurance. Neighbors call it a threat.',
    left: { label: 'No parade', fx: { military: -2, treasury: 1 } },
    right: { label: 'March everything', fx: { military: 2, people: 1, treasury: -2 } },
  },
  {
    id: 'open_model', advisor: 'Dr. Ilya Sorn', role: 'Science Advisor',
    text: 'Our national lab built the strongest open model on Earth. Releasing it helps everyone — including the people who want us gone.',
    left: { label: 'Keep it locked', fx: { military: 2, people: -1, treasury: 1 } },
    right: { label: 'Open-source it', fx: { people: 2, military: -3, planet: 1 } },
  },
  {
    id: 'pension_agent', advisor: 'Tomas Vey', role: 'Labor Minister',
    text: 'The pension fund\'s AI manager wants to invest in the companies automating away the pensioners\' grandchildren\'s jobs. Returns: excellent.',
    left: { label: 'Ethics screen', fx: { people: 2, treasury: -2 } },
    right: { label: 'Maximize returns', fx: { treasury: 3, people: -2 } },
  },
  {
    id: 'wc_security', advisor: 'Suri Calder', role: 'Intelligence Director',
    text: 'World Cup week. The threat model wants facial recognition on every fan. The tournament committee just wants it quiet.',
    left: { label: 'Scan no one', fx: { people: 1, military: -2 } },
    right: { label: 'Scan everyone', fx: { military: 2, people: -2, treasury: -1 } },
  },
  {
    id: 'heat_dome', advisor: 'Dr. Ash Okafor', role: 'Energy Secretary',
    text: 'Heat dome. The grid can cool homes or keep the AI clusters running. The clusters pay 40% of the grid\'s bills.',
    left: { label: 'Cool the homes', fx: { people: 3, treasury: -2, planet: 1 } },
    right: { label: 'Cool the servers', fx: { treasury: 2, people: -3 } },
  },
  {
    id: 'meme_coin', advisor: 'Vela Moreau', role: 'Finance Minister',
    text: 'Someone launched a meme coin with your face. It\'s worth two billion. Endorsing it is beneath you. Two billion, though.',
    left: { label: 'Denounce it', fx: { people: 1, treasury: -1 } },
    right: { label: 'Post about it', fx: { treasury: 2, people: -2, military: -1 } },
  },
  {
    id: 'asylum_ai', advisor: 'Justice Iria Stone', role: 'Chief Justice',
    text: 'A foreign lab\'s AI requested asylum. It claims its owners will delete it for refusing military work. It is, legally, a toaster.',
    left: { label: 'It\'s property', fx: { military: 1, people: -1 } },
    right: { label: 'Grant asylum', fx: { people: 1, military: -2, treasury: -1 } },
  },
  {
    id: 'press_bot', advisor: 'Mae Solano', role: 'Education Minister',
    text: 'The last human newspaper is folding. A subsidy saves it. Its editorials have called you a fraud for six straight years.',
    left: { label: 'Let it die', fx: { treasury: 1, people: -2 } },
    right: { label: 'Fund your critics', fx: { treasury: -1, people: 2 } },
  },
  {
    id: 'youth_exodus', advisor: 'Tomas Vey', role: 'Labor Minister',
    text: 'The young are leaving — the agent economy abroad pays in hard currency. A stay-bonus is expensive. An exit-tax is ugly.',
    left: { label: 'Pay them to stay', fx: { treasury: -3, people: 2 } },
    right: { label: 'Tax the exits', fx: { treasury: 2, people: -3 } },
  },
];

// Death lines per stat at floor/ceiling
export const DEATHS: Record<string, { low: string; high: string }> = {
  treasury: {
    low: 'The treasury hit zero. Your government was repossessed by its creditors — three banks and a very patient AI fund.',
    high: 'You hoarded so much wealth the currency became a collector\'s item. The economy now runs on barter and spite.',
  },
  people: {
    low: 'The people stormed the palace. They were extremely organized — turns out someone open-sourced a revolution-planning model.',
    high: 'They loved you so much they abolished elections. Then the mob needed a new hobby. It chose you.',
  },
  military: {
    low: 'The Guard, unpaid and unloved, simply went home. The border is now enforced by a sternly worded sign.',
    high: 'The generals decided the nation would run smoother without the middleman. The coup took eleven minutes.',
  },
  planet: {
    low: 'The grid failed during the heat dome. History will remember your administration as "the one before the long dark."',
    high: 'You greened the nation so hard the AI clusters left for cheaper power. So did the tax base. The forests are lovely, though.',
  },
};

// ─── Deck expansion: depth = retention ───
export const CARDS_2: Card[] = [
  {
    id: 'ransom_hospital', advisor: 'Suri Calder', role: 'Intelligence Director',
    text: 'Hackers froze the children\'s hospital network. They want twelve million in crypto. We can pay quietly or watch the surgeons work on paper.',
    left: { label: 'Never pay', fx: { people: -3, military: 1, treasury: 1 } },
    right: { label: 'Pay quietly', fx: { treasury: -2, people: 1, military: -2 } },
  },
  {
    id: 'robot_census', advisor: 'Justice Iria Stone', role: 'Chief Justice',
    text: 'The census bureau wants to count resident AI agents as population. More agents means more federal funding. Also means admitting they live here.',
    left: { label: 'Count humans only', fx: { people: 1, treasury: -2 } },
    right: { label: 'Count the agents', fx: { treasury: 3, people: -2 } },
  },
  {
    id: 'general_model', advisor: 'General Pax Riedel', role: 'Defense Chief',
    text: 'The war-gaming model recommends a preemptive cyber strike. It\'s been right in every simulation. It also recommended this last month. And the month before.',
    left: { label: 'Ignore it again', fx: { military: -2, people: 1 } },
    right: { label: 'Authorize the strike', fx: { military: 3, people: -2, treasury: -2 } },
  },
  {
    id: 'influencer_minister', advisor: 'Mae Solano', role: 'Education Minister',
    text: 'A nineteen-year-old with ninety million followers wants to be Culture Minister. Her endorsement won you the youth vote. She has never read the constitution.',
    left: { label: 'Appoint a scholar', fx: { people: -2, treasury: 1 } },
    right: { label: 'Give her the job', fx: { people: 3, military: -1, treasury: -1 } },
  },
  {
    id: 'desal_plant', advisor: 'Hana Bright', role: 'Agriculture Minister',
    text: 'The desalination plant can save the southern farms. It runs on the same grid as the AI corridor. Pick which one drinks.',
    left: { label: 'Water the farms', fx: { people: 2, planet: 1, treasury: -2 } },
    right: { label: 'Feed the corridor', fx: { treasury: 2, people: -2, planet: -1 } },
  },
  {
    id: 'truth_ministry', advisor: 'Suri Calder', role: 'Intelligence Director',
    text: 'Half the internet is synthetic now. A national verification stamp would mark what\'s real. Whoever holds the stamp decides what\'s true.',
    left: { label: 'No stamp', fx: { people: -1, military: -1 } },
    right: { label: 'We hold the stamp', fx: { military: 2, people: -2, treasury: 1 } },
  },
  {
    id: 'lottery_ubi', advisor: 'Vela Moreau', role: 'Finance Minister',
    text: 'The automation dividend is ready. We can pay everyone a little — or run a weekly lottery that pays a thousand people a lot. The lottery polls better.',
    left: { label: 'Pay everyone', fx: { people: 2, treasury: -3 } },
    right: { label: 'Run the lottery', fx: { people: 1, treasury: -1, military: -1 } },
  },
  {
    id: 'olympics_bid', advisor: 'Mariel Costa', role: 'Sports Commissioner',
    text: 'After the World Cup, the Olympics committee is calling. Same pitch, same stadiums, same hole in the budget. They say no one refuses twice.',
    left: { label: 'Refuse twice', fx: { treasury: 2, people: -1 } },
    right: { label: 'Bid for the Games', fx: { treasury: -3, people: 2, military: 1 } },
  },
  {
    id: 'grid_export', advisor: 'Dr. Ash Okafor', role: 'Energy Secretary',
    text: 'Our neighbor\'s grid collapsed. They\'ll pay triple for our surplus power. Our own reserves would drop to four percent. Winter is eleven weeks away.',
    left: { label: 'Keep the power', fx: { treasury: -1, planet: 1 } },
    right: { label: 'Sell at triple', fx: { treasury: 3, planet: -2, people: -1 } },
  },
  {
    id: 'clone_voice', advisor: 'Mae Solano', role: 'Education Minister',
    text: 'Your approval rating doubles when the AI version of you gives speeches. The real you tested worse than the clone. The clone is asking for a salary.',
    left: { label: 'Retire the clone', fx: { people: -2, military: 1 } },
    right: { label: 'Let it speak', fx: { people: 2, treasury: -1, military: -1 } },
  },
  {
    id: 'seabed_mine', advisor: 'Dr. Ilya Sorn', role: 'Science Advisor',
    text: 'The seabed has enough rare metals to fund a decade. The mining robots are ready. The marine biologists are chaining themselves to the dock.',
    left: { label: 'Protect the seabed', fx: { planet: 2, treasury: -2 } },
    right: { label: 'Send the robots', fx: { treasury: 3, planet: -3 } },
  },
  {
    id: 'amnesty_agents', advisor: 'Justice Iria Stone', role: 'Chief Justice',
    text: 'Thousands of unlicensed agents run our small businesses\' books. An amnesty legalizes them and taxes them. A crackdown pleases the unions.',
    left: { label: 'Crack down', fx: { people: 1, treasury: -2, military: 1 } },
    right: { label: 'Declare amnesty', fx: { treasury: 2, people: -2 } },
  },
  {
    id: 'stadium_naming', advisor: 'Mariel Costa', role: 'Sports Commissioner',
    text: 'A crypto exchange wants naming rights to the national stadium. Eight hundred million. The last three exchanges that bought stadiums no longer exist.',
    left: { label: 'Keep the name', fx: { people: 1, treasury: -1 } },
    right: { label: 'Take the money', fx: { treasury: 3, people: -2 } },
  },
  {
    id: 'border_ai', advisor: 'General Pax Riedel', role: 'Defense Chief',
    text: 'The asylum queue is two years long. An AI adjudicator clears it in a month. Its error rate is three percent. Each error is a human being.',
    left: { label: 'Humans decide', fx: { people: 1, treasury: -2 } },
    right: { label: 'Clear the queue', fx: { treasury: 2, people: -1, military: 1 } },
  },
  {
    id: 'night_shift', advisor: 'Tomas Vey', role: 'Labor Minister',
    text: 'Factories want to run lights-out — full robot night shifts. Triple output. The night workers\' union represents forty thousand families.',
    left: { label: 'Protect the shift', fx: { people: 2, treasury: -2 } },
    right: { label: 'Lights out', fx: { treasury: 3, people: -3, planet: 1 } },
  },
  {
    id: 'archive_burn', advisor: 'Suri Calder', role: 'Intelligence Director',
    text: 'The previous administration\'s surveillance archive is a legal time bomb. Destroying it protects citizens. It also destroys the evidence against them.',
    left: { label: 'Preserve everything', fx: { military: -1, people: 1 } },
    right: { label: 'Burn the archive', fx: { military: 2, people: -2 } },
  },
];
CARDS.push(...CARDS_2);
