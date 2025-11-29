/**
 * Template Types
 * Types for template management API
 */

export enum TemplateCategory {
	MAIN = "MAIN",
	AUTH = "AUTH",
	PROFILE = "PROFILE",
	ISSUE = "ISSUE",
	DOMAIN = "DOMAIN",
	ORGANIZATION = "ORGANIZATION",
	PROJECT = "PROJECT",
	OTHER = "OTHER",
}

export enum TemplateSortField {
	NAME = "name",
	MODIFIED = "modifiedAt",
	VIEWS = "viewCount",
	CREATED = "createdAt",
}

export enum TemplateFilterBy {
	ALL = "all",
	WITH_SIDENAV = "with_sidenav",
	WITH_BASE = "with_base",
	WITH_STYLES = "with_styles",
}

export interface TemplateMetadata {
	hasSidenav: boolean;
	extendsBase: boolean;
	hasStyleTags: boolean;
}

export interface TemplateListQueryParams {
	search?: string;
	filter?: TemplateFilterBy;
	sort?: TemplateSortField;
	dir?: "asc" | "desc";
	page?: number;
	perPage?: number;
	category?: TemplateCategory;
}

export interface TemplateResponse {
	id: number;
	name: string;
	path: string;
	category: TemplateCategory;
	description?: string;
	hasSidenav: boolean;
	extendsBase: boolean;
	hasStyleTags: boolean;
	url?: string;
	viewCount: number;
	modifiedAt: Date;
	createdAt: Date;
	updatedAt: Date;
}

export interface TemplateListResponse {
	templates: TemplateResponse[];
	pagination: {
		total: number;
		page: number;
		perPage: number;
		totalPages: number;
		hasNext: boolean;
		hasPrev: boolean;
	};
	filters: {
		search?: string;
		filter: TemplateFilterBy;
		sort: TemplateSortField;
		direction: "asc" | "desc";
		category?: TemplateCategory;
	};
}

export interface CreateTemplateRequest {
	name: string;
	path: string;
	category?: TemplateCategory;
	description?: string;
	hasSidenav?: boolean;
	extendsBase?: boolean;
	hasStyleTags?: boolean;
	url?: string;
	modifiedAt: Date;
}

export interface UpdateTemplateRequest {
	name?: string;
	path?: string;
	category?: TemplateCategory;
	description?: string;
	hasSidenav?: boolean;
	extendsBase?: boolean;
	hasStyleTags?: boolean;
	url?: string;
	modifiedAt?: Date;
}

export interface TemplateBatchCreateRequest {
	templates: CreateTemplateRequest[];
}

export interface TemplateBatchUpdateRequest {
	updates: Array<{
		id: number;
		data: UpdateTemplateRequest;
	}>;
}

export interface TemplateStatsResponse {
	totalTemplates: number;
	totalViews: number;
	categoryCounts: Record<TemplateCategory, number>;
	filterCounts: {
		withSidenav: number;
		withBase: number;
		withStyles: number;
	};
}
