# Data Model

## competitions
| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid | owner reference (nullable v1) |
| name | text | e.g. "IKO Goju-ryu Malaysia Open 2025" |
| venue | text | |
| event_date | date | |
| registration_deadline | date | |
| registration_fee_myr | numeric | |
| status | text | draft / open / closed / completed |
| description | text | |
| created_at | timestamptz | |

## schools
| id | uuid PK | |
| user_id | uuid | nullable |
| name | text | dojo/club name |
| state | text | Malaysian state |
| affiliation_code | text | IKO ref |
| created_at | timestamptz | |

## senseis
| id | uuid PK | |
| user_id | uuid | nullable |
| name | text | |
| rank | text | e.g. Godan / Yondan |
| school_id | uuid → schools | |
| created_at | timestamptz | |

## categories
| id | uuid PK | |
| competition_id | uuid → competitions | |
| name | text | e.g. "Junior Male Kyu" |
| age_min | int | |
| age_max | int | |
| belt_group | text | kyu / dan |
| gender | text | male / female / open |
| created_at | timestamptz | |

## participants
| id | uuid PK | |
| user_id | uuid | nullable |
| full_name | text | |
| ic_passport | text | |
| date_of_birth | date | |
| gender | text | |
| belt_rank | text | |
| school_id | uuid → schools | |
| sensei_id | uuid → senseis | |
| created_at | timestamptz | |

## registrations
| id | uuid PK | |
| user_id | uuid | nullable |
| competition_id | uuid → competitions | |
| participant_id | uuid → participants | |
| category_id | uuid → categories | |
| payment_status | text | pending / paid / rejected |
| payment_reference | text | bank transfer ref |
| notes | text | |
| created_at | timestamptz | |

## announcements
| id | uuid PK | |
| user_id | uuid | nullable |
| competition_id | uuid → competitions | nullable |
| title | text | |
| body | text | markdown |
| published | boolean | |
| created_at | timestamptz | |

## AI Fields
Any future AI-generated field (e.g. suggested_category) stores:
- `value text`, `source text`, `confidence numeric`, `review_status text default 'unreviewed'`

## RLS
- v1: permissive read + write for all tables (demo-first)
- Lock-down sprint: owner-scoped writes via `auth.uid() = user_id`
