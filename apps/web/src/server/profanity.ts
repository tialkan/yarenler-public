/**
 * Explicit swear words, checked locally before any AI call on new research field names.
 * Deliberately short and unambiguous: only words that are insults in every context, matched on whole
 * words (Turkish lower case), so research vocabulary is never caught ("sikke", "götürmek", "amin",
 * "PIC" stay). Everything subtler is the AI review's job.
 */
const START='(?<![\\p{L}\\p{N}])',END='(?![\\p{L}\\p{N}])';
const STEMS=[
 // Stem plus any suffix.
 'orospu\\p{L}*','siktir\\p{L}*','sik(?:erim|eyim|iyim|tiğim|tigim|ik|iş|is|icem|eceğim|ecegim|ilmiş)\\p{L}*','yarra[kğg]\\p{L}*',
 'amc[ıi]k\\p{L}*','amına','amını','am[ıi]na\\s?ko[yd]\\p{L}*','kahpe\\p{L}*','pezevenk\\p{L}*','gavat\\p{L}*','puşt\\p{L}*','pust','şerefsiz\\p{L}*',
 'ibne\\p{L}*','yavşak\\p{L}*','dalyarak\\p{L}*','göt(?:veren|lek|ü|ün|üne|ünü|ünden)?','amk',
 'fuck\\p{L}*','motherfuck\\p{L}*','bitch\\p{L}*','cunt\\p{L}*','asshole\\p{L}*','shit','bastard\\p{L}*','whore\\p{L}*',
];
const PATTERN=new RegExp(START+'(?:'+STEMS.join('|')+')'+END,'u');
/** True when the text contains an explicit swear word from the list. */
export function containsProfanity(text:string){return PATTERN.test(text.normalize('NFC').toLocaleLowerCase('tr-TR'));}
