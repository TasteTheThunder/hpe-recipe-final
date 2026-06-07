package com.hpe.recipe.model;

import java.util.List;

public class Catalog {

    private String version;
    private String name;
    private String catalogName;
    private String catalogDescription;
    private String catalogReleaseDate;
    private String catalogStatus;
    private String maintainer;
    private List<Recipe> recipes;

    public Catalog() {}

    public Catalog(String version, String name, String catalogName, String catalogDescription,
                   String catalogReleaseDate, String catalogStatus, String maintainer,
                   List<Recipe> recipes) {
        this.version = version;
        this.name = name;
        this.catalogName = catalogName;
        this.catalogDescription = catalogDescription;
        this.catalogReleaseDate = catalogReleaseDate;
        this.catalogStatus = catalogStatus;
        this.maintainer = maintainer;
        this.recipes = recipes;
    }

    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getCatalogName() { return catalogName; }
    public void setCatalogName(String catalogName) { this.catalogName = catalogName; }

    public String getCatalogDescription() { return catalogDescription; }
    public void setCatalogDescription(String catalogDescription) { this.catalogDescription = catalogDescription; }

    public String getCatalogReleaseDate() { return catalogReleaseDate; }
    public void setCatalogReleaseDate(String catalogReleaseDate) { this.catalogReleaseDate = catalogReleaseDate; }

    public String getCatalogStatus() { return catalogStatus; }
    public void setCatalogStatus(String catalogStatus) { this.catalogStatus = catalogStatus; }

    public String getMaintainer() { return maintainer; }
    public void setMaintainer(String maintainer) { this.maintainer = maintainer; }

    public List<Recipe> getRecipes() { return recipes; }
    public void setRecipes(List<Recipe> recipes) { this.recipes = recipes; }
}
