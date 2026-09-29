export type Source = 'repo' | 'wiki' | 'workflow';
export type Authority = 'draft' | 'current' | 'archived';

export interface Frontmatter {
  id?: string;
  kind?: string;
  authority?: Authority;
  applies_to: string[];
  verified_by: string[];
  review_triggers: string[];
  families: string[];
  architecture: string[];
  modules: string[];
  members: string[];
  components: string[];
  design_specs: string[];
  owners: string[];
  approved_by: string[];
  parent_component?: string;
}

export interface Section {
  id: string;
  heading: string;
  level: number;
  body: string;
}

export interface Doc {
  id: string;
  source: Source;
  path: string;
  title: string;
  frontmatter?: Frontmatter;
  sections: Section[];
}
