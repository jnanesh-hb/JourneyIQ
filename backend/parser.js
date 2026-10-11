/**
 * JourneyIQ — Request Parser
 * 
 * Rule-based natural language parser and schema validator for travel requests.
 * Extracts structured constraints and performs multi-point validation.
 */

// Supported canonical cities in synthetic demo dataset (50 cities)
const KNOWN_CITIES = [
  // Andhra Pradesh & Telangana
  'Hyderabad', 'Vijayawada', 'Visakhapatnam', 'Rajahmundry', 'Tirupati',
  // Tamil Nadu
  'Chennai', 'Coimbatore', 'Madurai',
  // Karnataka
  'Bengaluru', 'Mysuru', 'Mangaluru', 'Hubli',
  // Kerala
  'Kochi', 'Thiruvananthapuram',
  // Maharashtra
  'Mumbai', 'Pune', 'Nagpur', 'Aurangabad', 'Goa',
  // Gujarat
  'Ahmedabad', 'Surat', 'Vadodara',
  // Rajasthan
  'Jaipur', 'Jodhpur', 'Udaipur', 'Ajmer', 'Kota',
  // Madhya Pradesh
  'Bhopal', 'Indore', 'Jabalpur',
  // Uttar Pradesh
  'Delhi', 'Lucknow', 'Kanpur', 'Varanasi', 'Agra', 'Mathura', 'Allahabad',
  // Punjab & Haryana
  'Amritsar', 'Ludhiana', 'Chandigarh',
  // Bihar & Jharkhand
  'Patna', 'Ranchi',
  // Odisha
  'Bhubaneswar', 'Cuttack',
  // West Bengal & North-East
  'Kolkata', 'Guwahati', 'Shillong', 'Imphal',
  // Chhattisgarh
  'Raipur',
  // Jammu & Kashmir
  'Srinagar',
];

// City name aliases/normalizations — covers common spellings, abbreviations, and old names
const CITY_ALIASES = {
  // Andhra / Telangana
  'hyderabad': 'Hyderabad',
  'hyd': 'Hyderabad',
  'secunderabad': 'Hyderabad',
  'vijayawada': 'Vijayawada',
  'bezawada': 'Vijayawada',
  'visakhapatnam': 'Visakhapatnam',
  'vizag': 'Visakhapatnam',
  'waltair': 'Visakhapatnam',
  'rajahmundry': 'Rajahmundry',
  'rajamahendravaram': 'Rajahmundry',
  'rjy': 'Rajahmundry',
  'tirupati': 'Tirupati',
  'tirumala': 'Tirupati',
  // Tamil Nadu
  'chennai': 'Chennai',
  'madras': 'Chennai',
  'coimbatore': 'Coimbatore',
  'kovai': 'Coimbatore',
  'cbe': 'Coimbatore',
  'madurai': 'Madurai',
  // Karnataka
  'bengaluru': 'Bengaluru',
  'bangalore': 'Bengaluru',
  'blr': 'Bengaluru',
  'mysuru': 'Mysuru',
  'mysore': 'Mysuru',
  'mangaluru': 'Mangaluru',
  'mangalore': 'Mangaluru',
  'hubli': 'Hubli',
  'hubballi': 'Hubli',
  // Kerala
  'kochi': 'Kochi',
  'cochin': 'Kochi',
  'ernakulam': 'Kochi',
  'thiruvananthapuram': 'Thiruvananthapuram',
  'trivandrum': 'Thiruvananthapuram',
  'tvm': 'Thiruvananthapuram',
  // Maharashtra
  'mumbai': 'Mumbai',
  'bombay': 'Mumbai',
  'bom': 'Mumbai',
  'pune': 'Pune',
  'poona': 'Pune',
  'nagpur': 'Nagpur',
  'aurangabad': 'Aurangabad',
  'goa': 'Goa',
  'panaji': 'Goa',
  'panjim': 'Goa',
  'vasco': 'Goa',
  // Gujarat
  'ahmedabad': 'Ahmedabad',
  'amdavad': 'Ahmedabad',
  'amd': 'Ahmedabad',
  'surat': 'Surat',
  'vadodara': 'Vadodara',
  'baroda': 'Vadodara',
  // Rajasthan
  'jaipur': 'Jaipur',
  'jodhpur': 'Jodhpur',
  'udaipur': 'Udaipur',
  'ajmer': 'Ajmer',
  'kota': 'Kota',
  // Madhya Pradesh
  'bhopal': 'Bhopal',
  'indore': 'Indore',
  'jabalpur': 'Jabalpur',
  'jabalpur': 'Jabalpur',
  // Uttar Pradesh
  'delhi': 'Delhi',
  'new delhi': 'Delhi',
  'ndls': 'Delhi',
  'lucknow': 'Lucknow',
  'lko': 'Lucknow',
  'kanpur': 'Kanpur',
  'cawnpore': 'Kanpur',
  'varanasi': 'Varanasi',
  'banaras': 'Varanasi',
  'benares': 'Varanasi',
  'kashi': 'Varanasi',
  'agra': 'Agra',
  'mathura': 'Mathura',
  'vrindavan': 'Mathura',
  'allahabad': 'Allahabad',
  'prayagraj': 'Allahabad',
  'prayag': 'Allahabad',
  // Punjab & Chandigarh
  'amritsar': 'Amritsar',
  'ludhiana': 'Ludhiana',
  'chandigarh': 'Chandigarh',
  // Bihar & Jharkhand
  'patna': 'Patna',
  'ranchi': 'Ranchi',
  // Odisha
  'bhubaneswar': 'Bhubaneswar',
  'bbsr': 'Bhubaneswar',
  'cuttack': 'Cuttack',
  // West Bengal & North-East
  'kolkata': 'Kolkata',
  'calcutta': 'Kolkata',
  'cal': 'Kolkata',
  'guwahati': 'Guwahati',
  'gauhati': 'Guwahati',
  'gwl': 'Guwahati',
  'shillong': 'Shillong',
  'imphal': 'Imphal',
  // Telugu Script Aliases
  'విశాఖపట్నం': 'Visakhapatnam',
  'విశాఖపట్టణం': 'Visakhapatnam',
  'వైజాగ్': 'Visakhapatnam',
  'విజయవాడ': 'Vijayawada',
  'హైదరాబాద్': 'Hyderabad',
  'హైదరాబాదు': 'Hyderabad',
  'సికింద్రాబాద్': 'Hyderabad',
  'రాజమండ్రి': 'Rajahmundry',
  'తిరుపతి': 'Tirupati',
  'తిరుమల': 'Tirupati',
  'చెన్నై': 'Chennai',
  'మద్రాస్': 'Chennai',
  'బెంగళూరు': 'Bengaluru',
  'బెంగళూర్': 'Bengaluru',
  'మంగళూరు': 'Mangaluru',
  'మైసూర్': 'Mysuru',
  'కొచ్చి': 'Kochi',
  'ముంబై': 'Mumbai',
  'పూణే': 'Pune',
  'పుణె': 'Pune',
  'ఢిల్లీ': 'Delhi',
  'న్యూఢిల్లీ': 'Delhi',
  'కోల్‌కతా': 'Kolkata',
  'అహ్మదాబాద్': 'Ahmedabad',
  'జైపూర్': 'Jaipur',
  'లక్నో': 'Lucknow',
  'వారణాసి': 'Varanasi',
  'ఆగ్రా': 'Agra',
  'భోపాల్': 'Bhopal',
  'ఇండోర్': 'Indore',
  'చండీగఢ్': 'Chandigarh',
  'పాట్నా': 'Patna',
  'రాంచీ': 'Ranchi',
  'భువనేశ్వర్': 'Bhubaneswar',
  'కటక్': 'Cuttack',
  'గువాహటి': 'Guwahati',
  'గోవా': 'Goa',
  'సూరత్': 'Surat',
  'నాగపూర్': 'Nagpur',
  'కాకినాడ': 'Visakhapatnam',
  'గుంటూరు': 'Vijayawada',
};

function cleanTeluguToken(str) {
  if (!str) return '';
  return str.replace(/(?:నుండి|నుంచి|నుంచీ|నికి|నకు|కి|కు|వరకు|లో|చేరాలి|వెళ్లాలి|ప్రయాణం)+$/u, '').trim();
}

function normalizeCity(name) {
  if (!name || typeof name !== 'string') return null;
  const raw = name.trim();
  const cleaned = cleanTeluguToken(raw);
  const lower = cleaned.toLowerCase();
  return CITY_ALIASES[cleaned] || CITY_ALIASES[lower] || KNOWN_CITIES.find(c => c.toLowerCase() === lower) || null;
}

/**
 * Validate ISO/YYYY-MM-DD calendar date
 */
function isValidDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const part = dateStr.split('T')[0];
  const match = part.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Parse a natural-language travel request into structured constraints.
 */
function parseRequest(text) {
  if (!text || typeof text !== 'string') {
    return { parsed: false, reason: 'Empty or invalid input text' };
  }

  const lower = text.toLowerCase();
  const result = {
    parsed: true,
    origin: null,
    destination: null,
    date: null,
    passengers: 1,
    budget: null,
    arrivalDeadline: null,
    preferredModes: [],
    transferPreference: null,
    accessibility: [],
    avoidOvernight: false,
    raw: text,
  };

  // Check Telugu From-To patterns (e.g. "విశాఖపట్నం నుండి విజయవాడకు")
  const teluguMatch = text.match(/([^\s]+)\s*(?:నుండి|నుంచి|నుంచీ)\s*([^\s]+)/u);
  if (teluguMatch) {
    const normOrigin = normalizeCity(teluguMatch[1]);
    const normDest = normalizeCity(teluguMatch[2]);
    if (normOrigin) result.origin = normOrigin;
    if (normDest) result.destination = normDest;
  }

  // Extract origin/destination using standard English patterns like "from X to Y"
  if (!result.origin || !result.destination) {
    const fromToMatch = lower.match(/from\s+([a-z\s]+?)\s+to\s+([a-z\s]+?)(?:\s+on|\s+by|\s+before|\s+for|\s+with|\s+budget|\s+tomorrow|\s+today|$)/);
    if (fromToMatch) {
      result.origin = normalizeCity(fromToMatch[1].trim()) || fromToMatch[1].trim();
      result.destination = normalizeCity(fromToMatch[2].trim()) || fromToMatch[2].trim();
    } else {
      // Scan text for known city names/aliases (including Telugu script)
      const tokens = text.split(/\s+/);
      const foundCities = [];
      
      for (const tok of tokens) {
        const norm = normalizeCity(tok);
        if (norm && !foundCities.includes(norm)) {
          foundCities.push(norm);
        }
      }

      if (foundCities.length >= 2) {
        if (!result.origin) result.origin = foundCities[0];
        if (!result.destination) result.destination = foundCities[1];
      } else if (foundCities.length === 1) {
        if (!result.origin && !result.destination) {
          if (lower.includes('from') || text.includes('నుండి') || text.includes('నుంచి')) {
            result.origin = foundCities[0];
          } else {
            result.destination = foundCities[0];
          }
        }
      }
    }
  }

  // Extract date: ISO, text months, or relative ("tomorrow", "today", "రేపు", "ఈరోజు")
  const isoDateMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDateMatch) {
    result.date = isoDateMatch[1] + 'T00:00:00';
  } else if (lower.includes('tomorrow') || lower.includes('today') || text.includes('రేపు') || text.includes('ఈరోజు')) {
    // Demo schedule dataset standard date is 2026-10-15
    result.date = '2026-10-15T00:00:00';
  } else {
    const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    for (let i = 0; i < monthNames.length; i++) {
      const monthMatch = lower.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthNames[i]}\\s*(\\d{4})?`));
      if (monthMatch) {
        const day = monthMatch[1].padStart(2, '0');
        const year = monthMatch[2] || '2026';
        const month = String(i + 1).padStart(2, '0');
        result.date = `${year}-${month}-${day}T00:00:00`;
        break;
      }
      const monthDayMatch = lower.match(new RegExp(`${monthNames[i]}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(\\d{4})?`));
      if (monthDayMatch) {
        const day = monthDayMatch[1].padStart(2, '0');
        const year = monthDayMatch[2] || '2026';
        const month = String(i + 1).padStart(2, '0');
        result.date = `${year}-${month}-${day}T00:00:00`;
        break;
      }
    }
  }

  // Extract passenger count
  const passengerMatch = lower.match(/(?:for\s+)?(\d+)\s+(?:people|persons?|passengers?|adults?|travell?ers?|pax)/) ||
                         lower.match(/(?:passengers?|people|persons?|adults?|travell?ers?|pax)\s*[:=]?\s*(\d+)/);
  if (passengerMatch) {
    result.passengers = parseInt(passengerMatch[1], 10);
  }

  // Extract budget: supports English & Telugu ("budget is ₹1,500", "బడ్జెట్ ₹1500", "1500 రూపాయలు", "రూ 1500")
  const budgetMatch = text.match(/(?:budget\s*(?:is|of|=|:)?|బడ్జెట్\s*(?:is|of|=|:)?|within|under|max|maximum|₹|Rs\.?|INR|రూ\.?)\s*([0-9,]+)/iu) ||
                      text.match(/([0-9,]+)\s*(?:రూపాయలు|రూ\.?|rupees)/iu);
  if (budgetMatch) {
    const val = budgetMatch[1] || budgetMatch[2];
    if (val) result.budget = parseInt(val.replace(/,/g, ''), 10);
  }

  // Extract arrival deadline: supports "arrive before 7 PM", "before 7 PM", "by 19:00", "arrive by 7 PM"
  const deadlineMatch = lower.match(/(?:arrive\s*(?:by|before)?|before|deadline|reach\s*(?:by|before)?)\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)?/);
  if (deadlineMatch) {
    let hour = parseInt(deadlineMatch[1].split(':')[0], 10);
    const min = deadlineMatch[1].includes(':') ? parseInt(deadlineMatch[1].split(':')[1], 10) : 0;
    if (deadlineMatch[2] === 'pm' && hour !== 12) hour += 12;
    if (deadlineMatch[2] === 'am' && hour === 12) hour = 0;
    const dateBase = result.date ? result.date.split('T')[0] : '2026-10-15';
    result.arrivalDeadline = `${dateBase}T${String(hour).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`;
  }

  // Extract preferences & accessibility
  if (lower.includes('train')) result.preferredModes.push('train');
  if (lower.includes('bus')) result.preferredModes.push('bus');
  if (lower.includes('flight') || lower.includes('fly')) result.preferredModes.push('flight');

  if (lower.includes('fewer transfer') || lower.includes('least transfer') || lower.includes('no transfer') || lower.includes('direct')) {
    result.transferPreference = 'fewer_transfers';
  }

  if (lower.includes('wheelchair') || lower.includes('accessible')) {
    result.accessibility.push('wheelchair_accessible');
  }

  if (lower.includes('avoid overnight') || lower.includes('no overnight')) {
    result.avoidOvernight = true;
  }

  return result;
}

/**
 * Validate that request has required fields, supported locations, and valid values.
 * Returns { valid: boolean, errors: string[], fieldErrors: Record<string, string> }
 */
function validateRequest(req) {
  const errors = [];
  const fieldErrors = {};

  // 1. Origin validation
  if (!req.origin || (typeof req.origin === 'string' && !req.origin.trim())) {
    const msg = 'Origin city is required';
    errors.push(msg);
    fieldErrors.origin = msg;
  } else {
    const normOrigin = normalizeCity(req.origin);
    if (!normOrigin) {
      const msg = `Unsupported origin "${req.origin}". Supported demo locations: ${KNOWN_CITIES.join(', ')}`;
      errors.push(msg);
      fieldErrors.origin = msg;
    }
  }

  // 2. Destination validation
  if (!req.destination || (typeof req.destination === 'string' && !req.destination.trim())) {
    const msg = 'Destination city is required';
    errors.push(msg);
    fieldErrors.destination = msg;
  } else {
    const normDest = normalizeCity(req.destination);
    if (!normDest) {
      const msg = `Unsupported destination "${req.destination}". Supported demo locations: ${KNOWN_CITIES.join(', ')}`;
      errors.push(msg);
      fieldErrors.destination = msg;
    }
  }

  // 3. Origin != Destination
  if (req.origin && req.destination && typeof req.origin === 'string' && typeof req.destination === 'string') {
    if (req.origin.trim().toLowerCase() === req.destination.trim().toLowerCase()) {
      const msg = 'Origin and destination must be different cities';
      errors.push(msg);
      fieldErrors.destination = msg;
    }
  }

  // 4. Travel Date validation
  if (!req.date) {
    const msg = 'Travel date is required';
    errors.push(msg);
    fieldErrors.date = msg;
  } else if (!isValidDate(req.date)) {
    const msg = 'Travel date must be a valid calendar date in YYYY-MM-DD format';
    errors.push(msg);
    fieldErrors.date = msg;
  }

  // 5. Passengers validation
  if (req.passengers !== undefined && req.passengers !== null && req.passengers !== '') {
    const num = Number(req.passengers);
    if (isNaN(num) || !Number.isInteger(num) || num < 1 || num > 10) {
      const msg = 'Passenger count must be an integer between 1 and 10';
      errors.push(msg);
      fieldErrors.passengers = msg;
    }
  }

  // 6. Budget validation
  if (req.budget !== undefined && req.budget !== null && req.budget !== '') {
    const b = Number(req.budget);
    if (isNaN(b) || b <= 0) {
      const msg = 'Budget must be a positive number greater than 0';
      errors.push(msg);
      fieldErrors.budget = msg;
    }
  }

  // 7. Arrival deadline validation (if provided)
  if (req.arrivalDeadline) {
    if (isNaN(Date.parse(req.arrivalDeadline))) {
      const msg = 'Arrival deadline must be a valid time or ISO timestamp';
      errors.push(msg);
      fieldErrors.arrivalDeadline = msg;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    fieldErrors,
  };
}

module.exports = {
  parseRequest,
  validateRequest,
  normalizeCity,
  isValidDate,
  KNOWN_CITIES,
};
