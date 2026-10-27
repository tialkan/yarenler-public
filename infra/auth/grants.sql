-- Migration 0030, for roles provisioned after migrations. No passwords are stored here.
GRANT SELECT,INSERT,UPDATE,DELETE ON orcid_session TO yarenler_auth;
GRANT SELECT,INSERT ON profile_field_review TO yarenler_auth;
GRANT SELECT,UPDATE(status) ON research_area_suggestion TO yarenler_auth;
GRANT SELECT,INSERT,DELETE ON person_collaboration_area TO yarenler_auth;
GRANT UPDATE(kaynak) ON person_research_area TO yarenler_auth;
