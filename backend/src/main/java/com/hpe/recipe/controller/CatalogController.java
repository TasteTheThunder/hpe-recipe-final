package com.hpe.recipe.controller;

import com.hpe.recipe.model.Catalog;
import com.hpe.recipe.model.Recipe;
import com.hpe.recipe.service.CatalogService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/catalogs")
public class CatalogController {

    private final CatalogService catalogService;

    public CatalogController(CatalogService catalogService) {
        this.catalogService = catalogService;
    }

    @GetMapping
    public List<Catalog> getAllCatalogs(@RequestParam String cluster) {
        return catalogService.getAllCatalogs(cluster);
    }

    @GetMapping("/{catalogVersion}/recipes")
    public List<Recipe> getRecipes(
            @PathVariable String catalogVersion,
            @RequestParam String cluster) {
        return catalogService.getRecipesByCatalog(cluster, catalogVersion);
    }
}
