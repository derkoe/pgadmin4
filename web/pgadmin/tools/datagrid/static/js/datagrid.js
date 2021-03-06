/////////////////////////////////////////////////////////////
//
// pgAdmin 4 - PostgreSQL Tools
//
// Copyright (C) 2013 - 2019, The pgAdmin Development Team
// This software is released under the PostgreSQL Licence
//
//////////////////////////////////////////////////////////////

define('pgadmin.datagrid', [
  'sources/gettext', 'sources/url_for', 'jquery', 'underscore',
  'pgadmin.alertifyjs', 'sources/pgadmin', 'bundled_codemirror',
  'sources/sqleditor_utils', 'backbone',
  'tools/datagrid/static/js/show_data',
  'tools/datagrid/static/js/get_panel_title',
  'tools/datagrid/static/js/show_query_tool', 'pgadmin.browser.toolbar',
  'wcdocker',
], function(
  gettext, url_for, $, _, alertify, pgAdmin, codemirror, sqlEditorUtils,
  Backbone, showData, panelTitle, showQueryTool, toolBar
) {
  // Some scripts do export their object in the window only.
  // Generally the one, which do no have AMD support.
  var wcDocker = window.wcDocker,
    pgBrowser = pgAdmin.Browser,
    CodeMirror = codemirror.default;

  /* Return back, this has been called more than once */
  if (pgAdmin.DataGrid)
    return pgAdmin.DataGrid;

  pgAdmin.DataGrid =
  _.extend(
    {
      init: function() {
        if (this.initialized)
          return;
        this.initialized = true;
        this.title_index = 1;


        let self = this;
        /* Cache may take time to load for the first time
         * Keep trying till available
         */
        let cacheIntervalId = setInterval(function() {
          if(pgBrowser.preference_version() > 0) {
            self.preferences = pgBrowser.get_preferences_for_module('sqleditor');
            clearInterval(cacheIntervalId);
          }
        },0);

        pgBrowser.onPreferencesChange('sqleditor', function() {
          self.preferences = pgBrowser.get_preferences_for_module('sqleditor');
        });


        // Define list of nodes on which view data option appears
        var supported_nodes = [
            'table', 'view', 'mview',
            'foreign_table', 'catalog_object', 'partition',
          ],

          /* Enable/disable View data menu in tools based
         * on node selected. if selected node is present
         * in supported_nodes, menu will be enabled
         * otherwise disabled.
         */
          view_menu_enabled = function(obj) {
            var isEnabled = (() => {
              if (!_.isUndefined(obj) && !_.isNull(obj))
                return (_.indexOf(supported_nodes, obj._type) !== -1 ? true : false);
              else
                return false;
            })();

            toolBar.enable(gettext('View Data'), isEnabled);
            toolBar.enable(gettext('Filtered Rows'), isEnabled);
            return isEnabled;
          },

          /* Enable/disable Query tool menu in tools based
         * on node selected. if selected node is present
         * in unsupported_nodes, menu will be disabled
         * otherwise enabled.
         */
          query_tool_menu_enabled = function(obj) {
            var isEnabled = (() => {
              if (!_.isUndefined(obj) && !_.isNull(obj)) {
                if (_.indexOf(pgAdmin.unsupported_nodes, obj._type) == -1) {
                  if (obj._type == 'database' && obj.allowConn) {
                    return true;
                  } else if (obj._type != 'database') {
                    return true;
                  } else {
                    return false;
                  }
                } else {
                  return false;
                }
              } else {
                return false;
              }
            })();

            toolBar.enable(gettext('Query Tool'), isEnabled);
            return isEnabled;
          };

        // Define the nodes on which the menus to be appear
        var menus = [{
          name: 'query_tool',
          module: this,
          applies: ['tools'],
          callback: 'show_query_tool',
          enable: query_tool_menu_enabled,
          priority: 1,
          label: gettext('Query Tool'),
          icon: 'fa fa-bolt',
        }];

        // Create context menu
        for (var idx = 0; idx < supported_nodes.length; idx++) {
          menus.push({
            name: 'view_all_rows_context_' + supported_nodes[idx],
            node: supported_nodes[idx],
            module: this,
            data: {
              mnuid: 3,
            },
            applies: ['context', 'object'],
            callback: 'show_data_grid',
            enable: view_menu_enabled,
            category: 'view_data',
            priority: 101,
            label: gettext('All Rows'),
          }, {
            name: 'view_first_100_rows_context_' + supported_nodes[idx],
            node: supported_nodes[idx],
            module: this,
            data: {
              mnuid: 1,
            },
            applies: ['context', 'object'],
            callback: 'show_data_grid',
            enable: view_menu_enabled,
            category: 'view_data',
            priority: 102,
            label: gettext('First 100 Rows'),
          }, {
            name: 'view_last_100_rows_context_' + supported_nodes[idx],
            node: supported_nodes[idx],
            module: this,
            data: {
              mnuid: 2,
            },
            applies: ['context', 'object'],
            callback: 'show_data_grid',
            enable: view_menu_enabled,
            category: 'view_data',
            priority: 103,
            label: gettext('Last 100 Rows'),
          }, {
            name: 'view_filtered_rows_context_' + supported_nodes[idx],
            node: supported_nodes[idx],
            module: this,
            data: {
              mnuid: 4,
            },
            applies: ['context', 'object'],
            callback: 'show_filtered_row',
            enable: view_menu_enabled,
            category: 'view_data',
            priority: 104,
            label: gettext('Filtered Rows...'),
          });
        }

        pgAdmin.Browser.add_menu_category('view_data', gettext('View/Edit Data'), 100, '');
        pgAdmin.Browser.add_menus(menus);

        // Creating a new pgAdmin.Browser frame to show the data.
        var dataGridFrameType = new pgAdmin.Browser.Frame({
          name: 'frm_datagrid',
          showTitle: true,
          isCloseable: true,
          isPrivate: true,
          url: 'about:blank',
        });

        // Load the newly created frame
        dataGridFrameType.load(pgBrowser.docker);
        this.on('pgadmin-datagrid:transaction:created', function(trans_obj) {
          this.launch_grid(trans_obj);
        });
      },

      // This is a callback function to show data when user click on menu item.
      show_data_grid: function(data, i) {
        showData.showDataGrid(this, pgBrowser, alertify, data, i);
      },

      // This is a callback function to show filtered data when user click on menu item.
      show_filtered_row: function(data, i) {
        var self = this,
          d = pgAdmin.Browser.tree.itemData(i);
        if (d === undefined) {
          alertify.alert(
            gettext('Data Grid Error'),
            gettext('No object selected.')
          );
          return;
        }

        // Get the parent data from the tree node hierarchy.
        var node = pgBrowser.Nodes[d._type],
          parentData = node.getTreeNodeHierarchy(i);

        // If server or database is undefined then return from the function.
        if (parentData.server === undefined || parentData.database === undefined) {
          return;
        }

        // If schema, view, catalog object all are undefined then return from the function.
        if (parentData.schema === undefined && parentData.view === undefined &&
             parentData.catalog === undefined) {
          return;
        }

        let nsp_name = showData.retrieveNameSpaceName(parentData);

        var url_params = {
          'cmd_type': data.mnuid,
          'obj_type': d._type,
          'sgid': parentData.server_group._id,
          'sid': parentData.server._id,
          'did': parentData.database._id,
          'obj_id': d._id,
        };

        var baseUrl = url_for('datagrid.initialize_datagrid', url_params);

        // Create url to validate the SQL filter
        var validateUrl = url_for('datagrid.filter_validate', {
          'sid': url_params['sid'],
          'did': url_params['did'],
          'obj_id': url_params['obj_id'],
        });

        let grid_title = showData.generateDatagridTitle(parentData, nsp_name, d);

        // Create filter dialog using alertify
        if (!alertify.filterDialog) {
          alertify.dialog('filterDialog', function factory() {
            return {
              main: function(title, message, baseUrl, validateUrl) {
                this.set('title', title);
                this.message = message;
                this.baseUrl = baseUrl;
                this.validateUrl = validateUrl;
              },

              setup:function() {
                return {
                  buttons:[{
                    text: gettext('Cancel'),
                    key: 27,
                    className: 'btn btn-secondary fa fa-times pg-alertify-button',
                  },{
                    text: gettext('OK'),
                    key: 13,
                    className: 'btn btn-primary fa fa-check pg-alertify-button',
                  }],
                  options: {
                    modal: 0,
                    resizable: true,
                    maximizable: false,
                    pinnable: false,
                    autoReset: false,
                  },
                };
              },
              build: function() {
                alertify.pgDialogBuild.apply(this);
              },
              prepare:function() {
                var that = this,
                  $content = $(this.message),
                  $sql_filter = $content.find('#sql_filter');

                $(this.elements.header).attr('data-title', this.get('title'));
                $(this.elements.body.childNodes[0]).addClass(
                  'dataview_filter_dialog'
                );

                this.setContent($content.get(0));
                // Disable OK button
                that.__internal.buttons[1].element.disabled = true;

                // Apply CodeMirror to filter text area.
                this.filter_obj = CodeMirror.fromTextArea($sql_filter.get(0), {
                  lineNumbers: true,
                  mode: 'text/x-pgsql',
                  extraKeys: pgBrowser.editor_shortcut_keys,
                  indentWithTabs: !self.preferences.use_spaces,
                  indentUnit: self.preferences.tab_size,
                  tabSize: self.preferences.tab_size,
                  lineWrapping: self.preferences.wrap_code,
                  autoCloseBrackets: self.preferences.insert_pair_brackets,
                  matchBrackets: self.preferences.brace_matching,
                });

                let sql_font_size = sqlEditorUtils.calcFontSize(self.preferences.sql_font_size);
                $(this.filter_obj.getWrapperElement()).css('font-size', sql_font_size);

                setTimeout(function() {
                  // Set focus on editor
                  that.filter_obj.refresh();
                  that.filter_obj.focus();
                }, 500);

                that.filter_obj.on('change', function() {
                  if (that.filter_obj.getValue() !== '') {
                    that.__internal.buttons[1].element.disabled = false;
                  } else {
                    that.__internal.buttons[1].element.disabled = true;
                  }
                });
              },

              callback: function(closeEvent) {

                if (closeEvent.button.text == gettext('OK')) {
                  var sql = this.filter_obj.getValue();
                  var that = this;
                  closeEvent.cancel = true; // Do not close dialog

                  // Make ajax call to include the filter by selection
                  $.ajax({
                    url: that.validateUrl,
                    method: 'POST',
                    async: false,
                    contentType: 'application/json',
                    data: JSON.stringify(sql),
                  })
                    .done(function(res) {
                      if (res.data.status) {
                      // Initialize the data grid.
                        self.create_transaction(that.baseUrl, null, 'false', parentData.server.server_type, '', grid_title, sql, false);
                        that.close(); // Close the dialog
                      }
                      else {
                        alertify.alert(
                          gettext('Validation Error'),
                          res.data.result
                        );
                      }
                    })
                    .fail(function(e) {
                      alertify.alert(
                        gettext('Validation Error'),
                        e
                      );
                    });
                }
              },
            };
          });
        }

        $.get(url_for('datagrid.filter'),
          function(data) {
            alertify.filterDialog('Data Filter', data, baseUrl, validateUrl)
              .resizeTo(pgBrowser.stdW.sm,pgBrowser.stdH.sm);
          }
        );
      },

      get_panel_title: function() {
        return panelTitle.getPanelTitle(pgBrowser);
      },
      // This is a callback function to show query tool when user click on menu item.
      show_query_tool: function(url, aciTreeIdentifier, panelTitle) {
        showQueryTool.showQueryTool(this, pgBrowser, alertify, url,
          aciTreeIdentifier, panelTitle);
      },
      create_transaction: function(baseUrl, target, is_query_tool, server_type, sURL, panel_title, sql_filter, recreate) {
        var self = this;
        target =  target || self;
        if (recreate) {
          baseUrl += '?recreate=1';
        }

        /* Send the data only if required. Sending non required data may
         * cause connection reset error if data is not read by flask server
         */
        let reqData = null;
        if(sql_filter != '') {
          reqData = JSON.stringify(sql_filter);
        }

        $.ajax({
          url: baseUrl,
          method: 'POST',
          dataType: 'json',
          data: reqData,
          contentType: 'application/json',
        })
          .done(function(res) {
            res.data.is_query_tool = is_query_tool;
            res.data.server_type = server_type;
            res.data.sURL = sURL;
            res.data.panel_title = panel_title;
            target.trigger('pgadmin-datagrid:transaction:created', res.data);
          })
          .fail(function(xhr) {
            if (target !== self) {
              if(xhr.status == 503 && xhr.responseJSON.info != undefined &&
                xhr.responseJSON.info == 'CONNECTION_LOST') {
                setTimeout(function() {
                  target.handle_connection_lost(true, xhr);
                });
                return;
              }
            }

            try {
              var err = JSON.parse(xhr.responseText);
              alertify.alert(gettext('Query Tool initialization error'),
                err.errormsg
              );
            } catch (e) {
              alertify.alert(gettext('Query Tool initialization error'),
                e.statusText
              );
            }
          });
      },
      launch_grid: function(trans_obj) {
        var self = this,
          panel_title = trans_obj.panel_title,
          grid_title = self.get_panel_title(),
          panel_icon = '',
          panel_tooltip = '';

        if (trans_obj.is_query_tool == 'false') {
          // Edit grid titles
          grid_title = panel_title + '/' + grid_title;
          panel_tooltip = gettext('View/Edit Data - ') + grid_title;
          panel_title = grid_title;
          panel_icon = 'fa fa-table';
        } else {
          if (panel_title) {
            // Script titles
            panel_tooltip = panel_title.toUpperCase() + ' ' + gettext('Script - ') + grid_title;
            panel_title = grid_title;
            panel_icon = 'fa fa-file-text-o';
          } else {
            // Query tool titles
            panel_tooltip = gettext('Query Tool - ') + grid_title;
            panel_title = grid_title;
            panel_icon = 'fa fa-bolt';
          }
        }

        // Open the panel if frame is initialized
        let titileForURLObj = sqlEditorUtils.removeSlashInTheString(grid_title);
        var url_params = {
            'trans_id': trans_obj.gridTransId,
            'is_query_tool': trans_obj.is_query_tool,
            'editor_title': titileForURLObj.title,
          },
          baseUrl = url_for('datagrid.panel', url_params) +
            '?' + 'query_url=' + encodeURI(trans_obj.sURL) +
            '&server_type=' + encodeURIComponent(trans_obj.server_type) +
            '&fslashes=' + titileForURLObj.slashLocations;

        if (self.preferences.new_browser_tab) {
          var newWin = window.open(baseUrl, '_blank');

          // add a load listener to the window so that the title gets changed on page load
          newWin.addEventListener('load', function() {
            newWin.document.title = panel_title;

            /* Set the initial version of pref cache the new window is having
             * This will be used by the poller to compare with window openers
             * pref cache version
             */
            //newWin.pgAdmin.Browser.preference_version(pgBrowser.preference_version());
          });

        } else {
          /* On successfully initialization find the dashboard panel,
           * create new panel and add it to the dashboard panel.
           */
          var propertiesPanel = pgBrowser.docker.findPanels('properties');
          var queryToolPanel = pgBrowser.docker.addPanel('frm_datagrid', wcDocker.DOCK.STACKED, propertiesPanel[0]);

          // Set panel title and icon
          queryToolPanel.title('<span title="'+panel_tooltip+'">'+panel_title+'</span>');
          queryToolPanel.icon(panel_icon);
          queryToolPanel.focus();

          // Listen on the panel closed event.
          queryToolPanel.on(wcDocker.EVENT.CLOSED, function() {
            $.ajax({
              url: url_for('datagrid.close', {'trans_id': trans_obj.gridTransId}),
              method: 'DELETE',
            });
          });

          var openQueryToolURL = function(j) {
            // add spinner element
            let $spinner_el =
              $(`<div class="pg-sp-container">
                    <div class="pg-sp-content">
                        <div class="row">
                            <div class="col-12 pg-sp-icon"></div>
                        </div>
                    </div>
                </div>`).appendTo($(j).data('embeddedFrame').$container);

            let init_poller_id = setInterval(function() {
              var frameInitialized = $(j).data('frameInitialized');
              if (frameInitialized) {
                clearInterval(init_poller_id);
                var frame = $(j).data('embeddedFrame');
                if (frame) {
                  frame.onLoaded(()=>{
                    $spinner_el.remove();
                  });
                  frame.openURL(baseUrl);
                }
              }
            }, 100);
          };

          openQueryToolURL(queryToolPanel);
        }
      },
    },
    Backbone.Events);

  return pgAdmin.DataGrid;
});
