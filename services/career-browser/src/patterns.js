'use strict';

const ATS = [
  ['Takafo+', 'Takafo', 'enterprise_ats', 98, [/\.takafo\.ai(?:\/|$)/i, /\/external-job\/details\//i]],
  ['Workday', 'Workday', 'enterprise_ats', 98, [/\.myworkdayjobs\.com(?:\/|$)/i, /\.myworkdaysite\.com(?:\/|$)/i]],
  ['Oracle HCM Cloud', 'Oracle', 'enterprise_ats', 98, [/\.oraclecloud\.com\/hcmUI\/CandidateExperience/i, /oraclecloud\.com.*CandidateExperience/i]],
  ['Oracle Taleo', 'Oracle', 'enterprise_ats', 98, [/\.taleo\.net\/careersection/i]],
  ['SAP SuccessFactors', 'SAP', 'enterprise_ats', 98, [/\.successfactors\.(?:com|eu)(?:\/|$)/i]],
  ['Talentera', 'Talentera', 'enterprise_ats', 98, [/\.talentera\.com(?:\/|$)/i, /\bpowered\s+by\s+talentera\b/i, /\btalentera\b.{0,100}\b(?:applicant tracking|recruitment|career portal)\b/i]],
  ['Elevatus', 'Elevatus', 'mid_market_ats', 97, [/\.elevatus\.io(?:\/|$)/i]],
  ['ZenATS', 'ZenHR', 'mid_market_ats', 98, [/\.zenats\.com(?:\/|$)/i, /\.cavall\.io(?:\/|$)/i, /\bpowered\s+by\s+zenats\b/i, /\bzenats\b.{0,100}\bzenhr\b/i]],
  ['Jisr ATS', 'Jisr', 'mid_market_ats', 97, [/jisr\.net\/(?:[a-z]{2}\/)?[^/?#]+\/careers(?:\/|$)/i, /\bpowered\s+by\s+(?:jisr|جسر)\b/i, /\bjisr\s+(?:applicant tracking system|ats)\b/i]],
  ['Bayzat ATS', 'Bayzat', 'mid_market_ats', 96, [/(?:jobs|careers|hiring)\.bayzat\.com(?:\/|$)/i, /\.bayzat\.com\/[^\s"']*(?:hiring|recruit|career|job|candidate)/i, /\bpowered\s+by\s+bayzat\b/i, /\bbayzat\s+(?:hiring management|applicant tracking system|ats)\b/i]],
  ['Palm HR', 'Palm HR', 'mid_market_ats', 98, [/careers\.palmhr\.io(?:\/|$)/i, /\.palmhr\.io\/jobs?(?:\/|$)/i, /\bpowered\s+by\s+palm\s*hr\b/i, /\bpalm\s+ats\b/i]],
  ['iBeeHire', 'iBeeHire', 'mid_market_ats', 98, [/\.ibeehire\.com(?:\/|$)/i, /\bpowered\s+by\s+ibeehire\b/i, /\bibeehire\s+ats\b/i]],
  ['Sniperhire', 'Cazar', 'enterprise_ats', 98, [/\.sniperhire\.net(?:\/|$)/i, /\bpowered\s+by\s+cazar\b/i, /\bsniperhire\b/i]],
  ['Menaitech Curio', 'Menaitech', 'enterprise_ats', 95, [/\.menaitech\.(?:com|net)(?:\/|$)/i, /\bcurio®?\b.{0,100}\bmenaitech\b/i, /\bmenaitech\b.{0,100}\b(?:talent acquisition|recruitment|applicant tracking)\b/i]],
  ['Greenhouse', 'Greenhouse', 'mid_market_ats', 98, [/(?:boards|job-boards)\.greenhouse\.io(?:\/|$)/i]],
  ['Lever', 'Lever', 'mid_market_ats', 98, [/jobs\.lever\.co(?:\/|$)/i]],
  ['SmartRecruiters', 'SmartRecruiters', 'mid_market_ats', 98, [/(?:jobs|careers)\.smartrecruiters\.com(?:\/|$)/i]],
  ['iCIMS', 'iCIMS', 'enterprise_ats', 98, [/\.icims\.com\/jobs/i]],
  ['Avature', 'Avature', 'enterprise_ats', 98, [/\.avature\.net(?:\/|$)/i]],
  ['Workable', 'Workable', 'mid_market_ats', 97, [/apply\.workable\.com(?:\/|$)/i, /workable\.com\/j\//i]],
  ['Ashby', 'Ashby', 'mid_market_ats', 98, [/jobs\.ashbyhq\.com(?:\/|$)/i]],
  ['Recruitee', 'Recruitee', 'mid_market_ats', 97, [/\.recruitee\.com(?:\/|$)/i]],
  ['Teamtailor', 'Teamtailor', 'mid_market_ats', 97, [/\.teamtailor\.com(?:\/|$)/i]],
  ['BambooHR', 'BambooHR', 'mid_market_ats', 96, [/\.bamboohr\.com\/(?:careers|jobs)/i]],
  ['Jobvite', 'Jobvite', 'mid_market_ats', 97, [/jobs\.jobvite\.com(?:\/|$)/i]],
  ['Cornerstone', 'Cornerstone', 'enterprise_ats', 97, [/\.csod\.com\/(?:ux\/)?ats\/careersite/i]],
  ['Darwinbox', 'Darwinbox', 'enterprise_ats', 96, [/\.darwinbox\.(?:in|com)(?:\/|$)/i]],
  ['PeopleStrong', 'PeopleStrong', 'enterprise_ats', 96, [/\.peoplestrong\.com(?:\/|$)/i]],
  ['PageUp', 'PageUp', 'enterprise_ats', 97, [/\.pageuppeople\.com(?:\/|$)/i]],
  ['Pinpoint', 'Pinpoint', 'mid_market_ats', 97, [/\.pinpointhq\.com(?:\/|$)/i]],
  ['Breezy HR', 'Breezy HR', 'mid_market_ats', 97, [/\.breezy\.hr(?:\/|$)/i]],
  ['JazzHR', 'JazzHR', 'mid_market_ats', 96, [/\.applytojob\.com(?:\/|$)/i]],
  ['UKG Recruiting', 'UKG', 'enterprise_ats', 97, [/recruiting\.ultipro\.com(?:\/|$)/i, /\.ukg\.net(?:\/|$)/i]],
  ['ADP Recruiting', 'ADP', 'enterprise_ats', 97, [/workforcenow\.adp\.com(?:\/|$)/i]],
  ['Zoho Recruit', 'Zoho', 'mid_market_ats', 96, [/\.zohorecruit\.(?:com|eu|in)(?:\/|$)/i]],
  ['Manatal', 'Manatal', 'mid_market_ats', 94, [/careers-page\.com(?:\/|$)/i]],
];

const CAREER_RE = /career|jobs?|vacanc|opportunit|talents?|recruit(?:ment|ing)?|employment|hiring|apply|join[- _]?us|work[- _]?with[- _]?us|open positions|current openings|وظائف|الوظائف|التوظيف|انضم\s*(?:إلينا|الينا|لفريقنا)|فرص\s*(?:عمل|وظيفية)|اعمل\s*معنا|العمل\s*معنا|التقديم\s*(?:للوظائف|على\s*الوظائف)?/i;
const JOB_RE = /\/job(?:s)?\/[^/?#]+|job-details?|external-job\/details|CandidateExperience|careersection|\/position(?:s)?\/|\/vacanc(?:y|ies)\/[^/?#]+|وظيف[ةي]|شواغر/i;
const BLOCKED_HOSTS = ['facebook.com','instagram.com','x.com','twitter.com','youtube.com','linkedin.com','indeed.com','glassdoor.com','bayt.com','naukrigulf.com','gulftalent.com','founditgulf.com','jobleads.com','jooble.org','talent.com','grabjobs.co','drjobpro.com','learn4good.com','monster.com','careerjet.com'];

module.exports = { ATS, CAREER_RE, JOB_RE, BLOCKED_HOSTS };
